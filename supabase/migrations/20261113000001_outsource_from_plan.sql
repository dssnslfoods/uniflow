-- Outsourcing is decided on the production plan, step by step, and nowhere else:
-- a step is ticked "send outside", given a vendor and a free-text brief. The process master no
-- longer has an "outsource" type, and the outsource page only dispatches what the plan decided.

alter table app.job_steps
  add column outsourced     boolean not null default false,
  add column outsource_note text check (length(outsource_note) <= 2000);

-- Existing outsource steps stay outsourced; fill a vendor from their last order or a vendor that
-- offers the process, so every outsourced step carries one.
alter table app.job_steps disable trigger derive;
alter table app.job_steps disable trigger guard;
update app.job_steps s
set outsourced = true,
    vendor_id = coalesce(
      s.vendor_id,
      (select o.vendor_id from app.outsource_orders o where o.job_step_id = s.id order by o.sent_at desc limit 1),
      (select vs.vendor_id from app.vendor_services vs join app.vendors v on v.id = vs.vendor_id
       where vs.process_id = s.process_id and v.deleted_at is null order by vs.lead_time_days, v.name limit 1),
      (select v.id from app.vendors v where v.tenant_id = s.tenant_id and v.deleted_at is null order by v.name limit 1))
where s.step_type = 'outsource';
alter table app.job_steps enable trigger derive;
alter table app.job_steps enable trigger guard;

-- Processes are what is done, not who does it.
update app.processes set step_type = 'internal' where step_type = 'outsource';
alter table app.processes add constraint processes_no_outsource_type check (step_type <> 'outsource');

-- Step type now follows the outsource tick: an outsourced step has a vendor and no machine.
create or replace function app.job_steps_derive() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_proc app.processes;
  v_mach app.machines;
begin
  select * into v_proc from app.processes where id = new.process_id;

  if new.outsourced then
    if v_proc.step_type = 'delivery' then
      perform app.fail('step.cannot_outsource');
    end if;
    if new.vendor_id is null then
      perform app.fail('step.vendor_required');
    end if;
    if (tg_op = 'INSERT' or new.vendor_id is distinct from old.vendor_id)
       and not exists (select 1 from app.vendors where id = new.vendor_id and tenant_id = new.tenant_id and deleted_at is null) then
      perform app.fail('outsource.vendor_not_found');
    end if;
    new.step_type := 'outsource';
    new.machine_id := null;
    new.est_minutes := null;
    new.outsource_note := nullif(btrim(new.outsource_note), '');
    return new;
  end if;

  new.step_type := v_proc.step_type;
  new.vendor_id := null;
  new.outsource_note := null;

  if new.machine_id is not null then
    if not exists (select 1 from app.machine_processes where machine_id = new.machine_id and process_id = new.process_id) then
      perform app.fail('step.machine_cannot_run_process');
    end if;
    select * into v_mach from app.machines where id = new.machine_id;
    if v_mach.status <> 'active' or v_mach.deleted_at is not null then
      perform app.fail('step.machine_unavailable');   -- BR-R08
    end if;
    new.est_minutes := app.estimate_step_minutes(
      new.planned_qty, new.n_up, new.passes,
      v_mach.setup_min, v_proc.default_running_waste_pct, v_mach.makeready_waste_units,
      v_mach.max_cap_per_hour, v_mach.efficiency_pct);
  else
    new.est_minutes := null;   -- unknown until a machine is chosen
  end if;
  return new;
end
$$;
drop trigger derive on app.job_steps;
create trigger derive before insert or update of process_id, machine_id, planned_qty, n_up, passes, outsourced, vendor_id, outsource_note
  on app.job_steps for each row execute function app.job_steps_derive();

-- Flow edits carry the outsource tick, vendor and brief too.
create or replace function api.edit_workflow(p_job uuid, p_steps jsonb, p_reason text default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job    app.jobs;
  v_item   jsonb;
  v_old    app.job_steps;
  v_ids    uuid[];
  v_locked constant app.step_status[] := '{in_progress,paused,done,skipped,failed}';
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  select * into v_job from app.jobs where id = p_job and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('job.not_found');
  end if;
  if v_job.status not in ('approved', 'in_production', 'on_hold') then
    perform app.fail('workflow.not_editable');
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    perform app.fail('plan.job_without_steps');
  end if;

  select array_agg((x ->> 'id')::uuid) into v_ids from jsonb_array_elements(p_steps) x where x ? 'id';
  v_ids := coalesce(v_ids, '{}');

  -- Locked steps can neither disappear nor change.
  if exists (select 1 from app.job_steps where job_id = p_job and status = any (v_locked) and not (id = any (v_ids))) then
    perform app.fail('workflow.locked_step_removed');
  end if;

  perform set_config('app.in_command', 'on', true);
  delete from app.job_steps where job_id = p_job and not (id = any (v_ids)) and not (status = any (v_locked));

  for v_item in select * from jsonb_array_elements(p_steps) loop
    if v_item ? 'id' then
      select * into v_old from app.job_steps where id = (v_item ->> 'id')::uuid and job_id = p_job;
      if not found then
        perform app.fail('step.not_found');
      end if;
      if v_old.status = any (v_locked) then
        if v_old.process_id <> (v_item ->> 'process_id')::uuid
           or v_old.machine_id is distinct from (v_item ->> 'machine_id')::uuid
           or v_old.seq <> (v_item ->> 'seq')::int
           or v_old.planned_qty <> (v_item ->> 'planned_qty')::numeric
           or v_old.outsourced <> coalesce((v_item ->> 'outsourced')::boolean, false)
           or v_old.vendor_id is distinct from (v_item ->> 'vendor_id')::uuid then
          perform app.fail('workflow.locked_step_changed');
        end if;
      else
        update app.job_steps set
          seq = (v_item ->> 'seq')::int,
          process_id = (v_item ->> 'process_id')::uuid,
          machine_id = (v_item ->> 'machine_id')::uuid,
          planned_qty = (v_item ->> 'planned_qty')::numeric,
          n_up = coalesce((v_item ->> 'n_up')::int, 1),
          passes = coalesce((v_item ->> 'passes')::int, 1),
          note = v_item ->> 'note',
          outsourced = coalesce((v_item ->> 'outsourced')::boolean, false),
          vendor_id = (v_item ->> 'vendor_id')::uuid,
          outsource_note = v_item ->> 'outsource_note',
          status = 'pending',
          queue_position = case when machine_id is distinct from (v_item ->> 'machine_id')::uuid then null else queue_position end,
          version = version + 1
        where id = v_old.id;
      end if;
    else
      insert into app.job_steps (tenant_id, job_id, seq, process_id, step_type, machine_id, planned_qty, n_up, passes, note,
                                 outsourced, vendor_id, outsource_note)
      select v_job.tenant_id, p_job, (v_item ->> 'seq')::int, p.id, p.step_type, (v_item ->> 'machine_id')::uuid,
             (v_item ->> 'planned_qty')::numeric, coalesce((v_item ->> 'n_up')::int, 1),
             coalesce((v_item ->> 'passes')::int, 1), v_item ->> 'note',
             coalesce((v_item ->> 'outsourced')::boolean, false), (v_item ->> 'vendor_id')::uuid, v_item ->> 'outsource_note'
      from app.processes p where p.id = (v_item ->> 'process_id')::uuid and p.tenant_id = v_job.tenant_id;
      if not found then
        perform app.fail('step.not_found');
      end if;
    end if;
  end loop;

  -- Submit the new version for approval (BR-R04).
  update app.jobs set status = 'pending_approval', workflow_version = workflow_version + 1, version = version + 1
  where id = p_job;
  update app.job_steps set workflow_version = v_job.workflow_version + 1 where job_id = p_job;
  insert into app.approvals (tenant_id, entity_id, version, action, comment, payload)
  select v_job.tenant_id, p_job, v_job.workflow_version + 1, 'submit', nullif(trim(p_reason), ''),
         jsonb_agg(to_jsonb(s) - 'tenant_id' order by s.seq)
  from app.job_steps s where s.job_id = p_job;
  perform app.log_job(p_job, 'workflow_edited', jsonb_build_object('version', v_job.workflow_version + 1, 'reason', p_reason));

  perform app.reschedule(v_job.tenant_id);
end
$$;

-- Dispatch: the vendor comes from the plan; only quantity, return date and cost are entered here.
drop function api.send_outsource(uuid, uuid, numeric, timestamptz, numeric, text);
create function api.send_outsource(
  p_step uuid, p_qty numeric, p_expected_at timestamptz, p_cost numeric default null, p_note text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_step app.job_steps;
  v_id   uuid;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  perform app.require_module('outsource');
  select * into v_step from app.job_steps where id = p_step and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('step.not_found');
  end if;
  if not v_step.outsourced then
    perform app.fail('outsource.not_outsource_step');
  end if;
  if v_step.status <> 'ready' then
    perform app.fail('step.not_ready');
  end if;
  if not exists (select 1 from app.jobs where id = v_step.job_id and status = 'in_production') then
    perform app.fail('step.job_not_released');
  end if;
  if not exists (select 1 from app.vendors where id = v_step.vendor_id and tenant_id = v_step.tenant_id and deleted_at is null) then
    perform app.fail('outsource.vendor_not_found');
  end if;
  if coalesce(p_qty, 0) <= 0 then
    perform app.fail('step.qty_invalid');
  end if;
  if p_expected_at is null or p_expected_at <= now() then
    perform app.fail('outsource.expected_in_past');
  end if;

  insert into app.outsource_orders (doc_no, job_step_id, vendor_id, qty_sent, expected_at, cost, note)
  values (app.next_doc_no('OS'), p_step, v_step.vendor_id, p_qty, p_expected_at, p_cost,
          coalesce(nullif(trim(p_note), ''), v_step.outsource_note))
  returning id into v_id;

  perform set_config('app.in_command', 'on', true);
  update app.job_steps
  set status = 'in_progress', actual_start = coalesce(actual_start, now()), version = version + 1
  where id = p_step;
  insert into app.production_logs (tenant_id, job_step_id, action, reason)
  values (v_step.tenant_id, p_step, 'start', 'outsource ' || (select doc_no from app.outsource_orders where id = v_id));
  perform app.log_job(v_step.job_id, 'outsource_sent', jsonb_build_object('order_id', v_id, 'vendor_id', v_step.vendor_id));
  perform app.reschedule(v_step.tenant_id);
  return v_id;
end
$$;
revoke execute on function api.send_outsource(uuid, numeric, timestamptz, numeric, text) from public, anon;
grant execute on function api.send_outsource(uuid, numeric, timestamptz, numeric, text) to authenticated;

-- Demo seed: coating is an ordinary process; the demo plans tick it "send outside" to ยูวีทอง.
create or replace function app.seed_demo(p_tenant uuid, p_actor uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_claims_before text := current_setting('request.jwt.claims', true);
  v_settings      jsonb;
  v_order         jsonb;
  v_job           jsonb;
  v_so            uuid;
  v_job_id        uuid;
  v_items         jsonb;
  v_customer      app.customers;
  v_line          int;
  v_released      uuid[];
  v_jobs_created  int := 0;
  v_orders        int := 0;
begin
  if not exists (select 1 from app.tenants where id = p_tenant) then
    perform app.fail('tenant.not_found');
  end if;
  if exists (select 1 from app.sales_orders where tenant_id = p_tenant and customer_po_no like 'DEMO-%') then
    return jsonb_build_object('skipped', true, 'reason', 'demo data already present');
  end if;

  -- Act as a full-rights member of the tenant for the duration of the seed.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_actor, 'role', 'authenticated', 'tenant_id', p_tenant,
    'roles', jsonb_build_array('admin', 'executive', 'manager', 'supervisor'))::text, true);

  -- Master data ------------------------------------------------------------------
  insert into app.processes (code, name, step_type, capacity_unit, default_setup_min, default_running_waste_pct, default_crew_size, sort_order)
  select x.* from (values
    ('DESIGN', 'ออกแบบ / จัดหน้า',  'design'::app.step_type,   'piece'::app.capacity_unit, 0,  0,   1, 10),
    ('PLATE',  'ทำเพลท',            'internal',                'piece',                   15, 0,   1, 20),
    ('OFFSET', 'พิมพ์ออฟเซ็ท',        'internal',                'sheet',                   45, 3,   2, 30),
    ('DIGITAL','พิมพ์ดิจิทัล',         'internal',                'sheet',                   5,  1,   1, 40),
    ('CUT',    'ตัด',               'internal',                'sheet',                   15, 0.5, 1, 50),
    ('COAT',   'เคลือบ UV / PVC',    'internal',                'sheet',                   0,  1,   0, 60),
    ('DIECUT', 'ไดคัท',             'internal',                'sheet',                   60, 2,   2, 70),
    ('GLUE',   'ปะกล่อง',           'internal',                'piece',                   40, 1,   2, 80),
    ('FOLD',   'พับ',               'internal',                'piece',                   20, 0.5, 1, 90),
    ('QC',     'ตรวจคุณภาพ',         'qc',                      'piece',                   0,  0,   1, 100),
    ('PACK',   'แพ็กสินค้า',          'internal',                'piece',                   0,  0,   2, 110)
  ) x(code, name, step_type, capacity_unit, setup, waste, crew, sort_order)
  on conflict (tenant_id, code) do nothing;

  insert into app.machines (code, name, machine_type, capacity_unit, max_cap_per_hour, setup_min, efficiency_pct, makeready_waste_units, crew_size, sort_order)
  select x.* from (values
    ('SM74',  'Heidelberg SM74',       'Offset 4 สี',   'sheet'::app.capacity_unit, 10000, 45, 80, 150, 2, 10),
    ('DGT01', 'Konica Minolta C14000', 'Digital',      'sheet',                    3000,  5,  90, 10,  1, 20),
    ('CUT01', 'Polar 115',             'เครื่องตัด',     'sheet',                    12000, 15, 85, 0,   1, 30),
    ('DIE01', 'Bobst SP102',           'ไดคัท',         'sheet',                    6000,  60, 80, 80,  2, 40),
    ('GLU01', 'Bobst Visionfold',      'ปะกล่อง',       'piece',                    15000, 40, 80, 50,  2, 50)
  ) x(code, name, machine_type, capacity_unit, cap, setup, eff, makeready, crew, sort_order)
  where not exists (select 1 from app.machines m where m.tenant_id = p_tenant and m.code = x.code);

  insert into app.machine_processes (machine_id, process_id)
  select m.id, p.id
  from (values ('SM74', 'OFFSET'), ('DGT01', 'DIGITAL'), ('CUT01', 'CUT'), ('DIE01', 'DIECUT'), ('GLU01', 'GLUE')) x(mcode, pcode)
  join app.machines m on m.tenant_id = p_tenant and m.code = x.mcode
  join app.processes p on p.tenant_id = p_tenant and p.code = x.pcode
  on conflict do nothing;

  insert into app.machine_costs (machine_id, cost_per_hour)
  select m.id, x.cost
  from (values ('SM74', 2500), ('DGT01', 900), ('CUT01', 600), ('DIE01', 1800), ('GLU01', 1500)) x(mcode, cost)
  join app.machines m on m.tenant_id = p_tenant and m.code = x.mcode
  on conflict (machine_id) do nothing;

  insert into app.customers (code, name, tax_id, credit_term_days, contacts, addresses)
  select x.code, x.name, x.tax_id, x.credit,
         jsonb_build_array(jsonb_build_object('name', x.contact, 'phone', x.phone)),
         jsonb_build_array(jsonb_build_object('label', 'default', 'address', x.address, 'is_default', true))
  from (values
    ('C-SIAM',  'บริษัท สยามคอสเมติก จำกัด',   '0105551000011', 30, 'คุณมาลี',   '02-111-2233', '99 ถ.พระราม 9 ห้วยขวาง กรุงเทพฯ 10310'),
    ('C-DOI',   'ดอยช้าง คอฟฟี่',             '0505560000022', 15, 'คุณภูผา',   '053-222-333', '12 ถ.นิมมานเหมินท์ เชียงใหม่ 50200'),
    ('C-ISB',   'โรงเรียนนานาชาติบางกอก',      '0994000033333', 45, 'คุณเจน',    '02-333-4455', '88 ซ.สุขุมวิท 15 วัฒนา กรุงเทพฯ 10110'),
    ('C-TFOOD', 'บริษัท ไทยฟู้ด อินดัสทรี จำกัด', '0105560044444', 60, 'คุณสมชาย',  '02-444-5566', '7/1 นิคมฯ บางปู สมุทรปราการ 10280'),
    ('C-GREEN', 'กรีนไลฟ์ ออร์แกนิค',          '0105562055555', 30, 'คุณนภา',    '089-555-6677', '45 ถ.ลาดพร้าว จตุจักร กรุงเทพฯ 10900')
  ) x(code, name, tax_id, credit, contact, phone, address)
  on conflict (tenant_id, code) do nothing;

  insert into app.vendors (code, name, contacts, rating)
  values ('V-UV', 'ร้านเคลือบเงา ยูวีทอง', jsonb_build_array(jsonb_build_object('name', 'คุณทอง', 'phone', '081-111-2222')), 4.5)
  on conflict (tenant_id, code) do nothing;
  insert into app.vendor_services (vendor_id, process_id, lead_time_days)
  select v.id, p.id, 2 from app.vendors v join app.processes p on p.tenant_id = v.tenant_id and p.code = 'COAT'
  where v.tenant_id = p_tenant and v.code = 'V-UV'
  on conflict do nothing;

  insert into app.materials (code, name, category, uom, purchase_uom, conversion_factor, min_stock, spec)
  select x.code, x.name, x.category, x.uom, x.puom, x.conv, x.min_stock, x.spec::jsonb
  from (values
    ('P-ART130', 'กระดาษอาร์ตมัน 130 แกรม 25×36"', 'paper', 'แผ่น', 'รีม', 500, 5000, '{"gsm": 130}'),
    ('P-ART260', 'กระดาษอาร์ตการ์ด 260 แกรม 25×36"', 'paper', 'แผ่น', 'รีม', 250, 3000, '{"gsm": 260}'),
    ('P-IVORY350', 'กระดาษกล่องแป้งหลังขาว 350 แกรม', 'paper', 'แผ่น', 'รีม', 125, 4000, '{"gsm": 350}'),
    ('P-STICKER', 'สติ๊กเกอร์ PP ขาวด้าน A3', 'paper', 'แผ่น', 'แพ็ก', 100, 1000, '{}'),
    ('I-CMYK', 'หมึกออฟเซ็ท CMYK', 'ink', 'กก.', 'กระป๋อง', 2.5, 20, '{}'),
    ('PL-CTP', 'เพลท CTP 745×605', 'plate', 'แผ่น', 'กล่อง', 50, 100, '{}')
  ) x(code, name, category, uom, puom, conv, min_stock, spec)
  on conflict (tenant_id, code) do nothing;

  -- Workflow templates (equal seq = parallel, D-07) --------------------------------
  insert into app.workflow_templates (name, description)
  select x.name, x.descr from (values
    ('กล่องบรรจุภัณฑ์', 'พิมพ์ออฟเซ็ท → เคลือบ (จ้างนอก) → ไดคัท → ปะกล่อง → QC → แพ็ก'),
    ('โบรชัวร์ / ใบปลิว', 'พิมพ์ออฟเซ็ท → ตัด → พับ → แพ็ก'),
    ('นามบัตร / งานด่วนดิจิทัล', 'พิมพ์ดิจิทัล → ตัด → แพ็ก'),
    ('ฉลากสติ๊กเกอร์', 'พิมพ์ดิจิทัล → ไดคัท ∥ QC → แพ็ก')
  ) x(name, descr)
  on conflict (tenant_id, name) do nothing;

  insert into app.workflow_template_steps (template_id, seq, process_id, default_machine_id)
  select t.id, x.seq, p.id, m.id
  from (values
    ('กล่องบรรจุภัณฑ์', 1, 'PLATE', null), ('กล่องบรรจุภัณฑ์', 2, 'OFFSET', 'SM74'), ('กล่องบรรจุภัณฑ์', 3, 'COAT', null),
    ('กล่องบรรจุภัณฑ์', 4, 'DIECUT', 'DIE01'), ('กล่องบรรจุภัณฑ์', 5, 'GLUE', 'GLU01'),
    ('กล่องบรรจุภัณฑ์', 6, 'QC', null), ('กล่องบรรจุภัณฑ์', 7, 'PACK', null),
    ('โบรชัวร์ / ใบปลิว', 1, 'PLATE', null), ('โบรชัวร์ / ใบปลิว', 2, 'OFFSET', 'SM74'), ('โบรชัวร์ / ใบปลิว', 3, 'CUT', 'CUT01'),
    ('โบรชัวร์ / ใบปลิว', 4, 'FOLD', null), ('โบรชัวร์ / ใบปลิว', 5, 'PACK', null),
    ('นามบัตร / งานด่วนดิจิทัล', 1, 'DIGITAL', 'DGT01'), ('นามบัตร / งานด่วนดิจิทัล', 2, 'CUT', 'CUT01'),
    ('นามบัตร / งานด่วนดิจิทัล', 3, 'PACK', null),
    ('ฉลากสติ๊กเกอร์', 1, 'DIGITAL', 'DGT01'), ('ฉลากสติ๊กเกอร์', 2, 'DIECUT', 'DIE01'), ('ฉลากสติ๊กเกอร์', 2, 'QC', null),
    ('ฉลากสติ๊กเกอร์', 3, 'PACK', null)
  ) x(tname, seq, pcode, mcode)
  join app.workflow_templates t on t.tenant_id = p_tenant and t.name = x.tname
  join app.processes p on p.tenant_id = p_tenant and p.code = x.pcode
  left join app.machines m on m.tenant_id = p_tenant and m.code = x.mcode
  where not exists (select 1 from app.workflow_template_steps s where s.template_id = t.id);

  -- Orders at every stage --------------------------------------------------------
  -- stage: production (released → board), pending (waiting for approval),
  --        confirmed (ready to plan), draft (PO being keyed in)
  for v_order in select * from jsonb_array_elements($json$[
    {"po": "DEMO-SIAM-0418", "customer": "C-SIAM", "po_ago": 6, "due_in": 12, "stage": "production",
     "items": [
       {"d": "กล่องครีมบำรุงผิว 50 ml", "qty": 20000, "price": 4.80, "spec": {"size": "6×6×12 ซม.", "paper": "กล่องแป้ง 350 แกรม", "colors": "4/0", "finishing": "เคลือบ UV + ไดคัท + ปะ"}},
       {"d": "ฉลากขวดครีม", "qty": 20000, "price": 0.65, "spec": {"size": "5×3 ซม.", "paper": "สติ๊กเกอร์ PP ขาวด้าน", "colors": "4/0", "finishing": "ไดคัทรูปทรง"}}],
     "jobs": [
       {"title": "กล่องครีม 50 ml", "template": "กล่องบรรจุภัณฑ์", "lines": [1], "n_up": 4},
       {"title": "ฉลากขวดครีม", "template": "ฉลากสติ๊กเกอร์", "lines": [2], "n_up": 24}]},
    {"po": "DEMO-DOI-112", "customer": "C-DOI", "po_ago": 2, "due_in": 3, "stage": "production",
     "items": [
       {"d": "นามบัตร คุณภูผา", "qty": 500, "price": 1.20, "spec": {"size": "9×5.5 ซม.", "paper": "อาร์ตการ์ด 260 แกรม", "colors": "4/4"}},
       {"d": "นามบัตร คุณดาว", "qty": 500, "price": 1.20, "spec": {"size": "9×5.5 ซม.", "paper": "อาร์ตการ์ด 260 แกรม", "colors": "4/4"}},
       {"d": "นามบัตร คุณเมฆ", "qty": 500, "price": 1.20, "spec": {"size": "9×5.5 ซม.", "paper": "อาร์ตการ์ด 260 แกรม", "colors": "4/4"}}],
     "jobs": [
       {"title": "นามบัตร 3 แบบ (พิมพ์รวมแผ่น)", "template": "นามบัตร / งานด่วนดิจิทัล", "lines": [1, 2, 3], "n_up": 21}]},
    {"po": "DEMO-ISB-2026-07", "customer": "C-ISB", "po_ago": 4, "due_in": 1, "stage": "production",
     "items": [
       {"d": "โบรชัวร์ Open House A4 พับ 3", "qty": 15000, "price": 2.10, "spec": {"size": "A4 พับ 3", "paper": "อาร์ตมัน 130 แกรม", "colors": "4/4", "finishing": "พับ 3 ตอน"}}],
     "jobs": [
       {"title": "โบรชัวร์ Open House", "template": "โบรชัวร์ / ใบปลิว", "lines": [1], "n_up": 2}]},
    {"po": "DEMO-TFOOD-PO889", "customer": "C-TFOOD", "po_ago": 1, "due_in": 14, "stage": "pending",
     "items": [
       {"d": "กล่องขนมเปี๊ยะ 6 ชิ้น", "qty": 12000, "price": 6.50, "spec": {"size": "18×12×5 ซม.", "paper": "กล่องแป้ง 350 แกรม", "colors": "4/0", "finishing": "เคลือบ PVC ด้าน + ไดคัท + ปะ"}},
       {"d": "กล่องขนมเปี๊ยะ 12 ชิ้น", "qty": 8000, "price": 9.80, "spec": {"size": "24×18×5 ซม.", "paper": "กล่องแป้ง 350 แกรม", "colors": "4/0", "finishing": "เคลือบ PVC ด้าน + ไดคัท + ปะ"}}],
     "jobs": [
       {"title": "กล่องขนมเปี๊ยะ 6 ชิ้น", "template": "กล่องบรรจุภัณฑ์", "lines": [1], "n_up": 4},
       {"title": "กล่องขนมเปี๊ยะ 12 ชิ้น", "template": "กล่องบรรจุภัณฑ์", "lines": [2], "n_up": 2}]},
    {"po": "DEMO-GREEN-031", "customer": "C-GREEN", "po_ago": 0, "due_in": 10, "stage": "confirmed",
     "items": [
       {"d": "แคตตาล็อกสินค้า A5 16 หน้า", "qty": 3000, "price": 18.00, "spec": {"size": "A5", "paper": "อาร์ตมัน 130 แกรม", "colors": "4/4", "finishing": "เย็บมุงหลังคา"}},
       {"d": "ใบปลิวโปรโมชั่น A5", "qty": 10000, "price": 0.90, "spec": {"size": "A5", "paper": "อาร์ตมัน 130 แกรม", "colors": "4/0"}}],
     "jobs": []},
    {"po": "DEMO-SIAM-0425", "customer": "C-SIAM", "po_ago": 0, "due_in": 21, "stage": "draft",
     "items": [
       {"d": "โปสเตอร์โปรโมชั่น A2", "qty": 500, "price": 12.00, "spec": {"size": "A2", "paper": "อาร์ตมัน 130 แกรม", "colors": "4/0"}}],
     "jobs": []}
  ]$json$::jsonb)
  loop
    select * into v_customer from app.customers where tenant_id = p_tenant and code = v_order ->> 'customer';

    insert into app.sales_orders (customer_id, customer_po_no, po_date, due_date, delivery_info)
    values (v_customer.id, v_order ->> 'po', current_date - (v_order ->> 'po_ago')::int,
            current_date + (v_order ->> 'due_in')::int,
            jsonb_build_object('address', v_customer.addresses -> 0 ->> 'address'))
    returning id into v_so;

    insert into app.sales_order_items (sales_order_id, line_no, description, spec, qty, unit_price)
    select v_so, i.ord, i.item ->> 'd', coalesce(i.item -> 'spec', '{}'), (i.item ->> 'qty')::numeric, (i.item ->> 'price')::numeric
    from jsonb_array_elements(v_order -> 'items') with ordinality i(item, ord);
    v_orders := v_orders + 1;

    continue when v_order ->> 'stage' = 'draft';
    perform api.confirm_sales_order(v_so);
    continue when v_order ->> 'stage' = 'confirmed';

    for v_job in select * from jsonb_array_elements(v_order -> 'jobs') loop
      select jsonb_agg(jsonb_build_object('sales_order_item_id', soi.id, 'qty', soi.qty))
        into v_items
      from app.sales_order_items soi
      where soi.sales_order_id = v_so
        and soi.line_no in (select (l)::int from jsonb_array_elements_text(v_job -> 'lines') l);

      v_job_id := api.create_job(
        v_so, v_job ->> 'title',
        (select id from app.workflow_templates where tenant_id = p_tenant and name = v_job ->> 'template'),
        v_items);

      update app.job_steps s set n_up = (v_job ->> 'n_up')::int
      from app.processes p
      where s.job_id = v_job_id and p.id = s.process_id and p.code in ('OFFSET', 'DIGITAL', 'DIECUT', 'CUT');
      update app.job_steps s
      set outsourced = true, vendor_id = (select id from app.vendors where tenant_id = p_tenant and code = 'V-UV'),
          outsource_note = 'เคลือบตามสเปกใน PO'
      from app.processes p
      where s.job_id = v_job_id and p.id = s.process_id and p.code = 'COAT';
      v_jobs_created := v_jobs_created + 1;
    end loop;

    perform api.submit_po_plan(v_so);
    continue when v_order ->> 'stage' = 'pending';

    -- Demo approval by the same actor: allow it for this call only, then restore the setting.
    select settings into v_settings from app.tenants where id = p_tenant;
    update app.tenants set settings = jsonb_set(settings, '{allow_self_approval}', 'true') where id = p_tenant;
    perform api.approve_po_plan(v_so);
    update app.tenants set settings = jsonb_set(settings, '{allow_self_approval}', coalesce(v_settings -> 'allow_self_approval', 'false'))
    where id = p_tenant;

    select array_agg(id) into v_released from app.jobs where sales_order_id = v_so and status = 'approved';
    perform api.release_jobs(v_released);
  end loop;

  perform set_config('request.jwt.claims', coalesce(v_claims_before, ''), true);
  return jsonb_build_object('skipped', false, 'orders', v_orders, 'jobs', v_jobs_created);
end
$$;
