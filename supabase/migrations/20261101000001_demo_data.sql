-- Demo data for trials and testing: a realistic print shop with every stage of the flow.
-- Parameterised by tenant and acting user; dates are relative to today; fits the trial plan
-- (5 machines). Runs through api.* so every business rule applies. Skips if demo POs exist.

create function app.seed_demo(p_tenant uuid, p_actor uuid) returns jsonb
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
    ('COAT',   'เคลือบ UV / PVC',    'outsource',               'sheet',                   0,  1,   0, 60),
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

revoke execute on function app.seed_demo(uuid, uuid) from public;

-- Shop admin loads demo data into their own shop; a platform admin can target any shop.
create function api.seed_demo(p_tenant uuid default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_tenant, app.tenant_id());
begin
  if auth.uid() is null then
    perform app.fail('auth.required');
  end if;
  if v_target is not distinct from app.tenant_id() then
    perform app.require_role('admin');
  else
    perform app.require_platform_admin();
  end if;
  return app.seed_demo(v_target, auth.uid());
end
$$;

revoke execute on function api.seed_demo(uuid) from public, anon;
grant execute on function api.seed_demo(uuid) to authenticated;
