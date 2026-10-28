-- Phase 2, part 2: inventory (FR-8.1–8.5, BR-06, BR-R07, G-08, G-13, D-01, D-08).
-- One warehouse per shop (D-08). Balances move only through movements; reservations live on
-- job_materials and roll up into stock_balances.reserved (G-13). Costs are visible to
-- admin / manager / executive only, through the masked views below.

create type app.stock_move_type as enum ('receive', 'issue', 'return', 'adjust');

create table app.stock_balances (
  tenant_id     uuid not null default app.tenant_id(),
  material_id   uuid not null,
  warehouse_id  uuid not null,
  on_hand       numeric(16,3) not null default 0 check (on_hand >= 0),
  reserved      numeric(16,3) not null default 0 check (reserved >= 0),
  avg_cost      numeric(16,4) not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (material_id, warehouse_id),
  foreign key (tenant_id, material_id) references app.materials (tenant_id, id) on delete cascade,
  foreign key (tenant_id, warehouse_id) references app.warehouses (tenant_id, id) on delete cascade
);
create index on app.stock_balances (tenant_id);

create table app.stock_movements (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null default app.tenant_id(),
  material_id   uuid not null,
  warehouse_id  uuid not null,
  type          app.stock_move_type not null,
  qty           numeric(16,3) not null,            -- signed: + into stock, − out of stock
  unit_cost     numeric(16,4) not null default 0,
  balance_after numeric(16,3) not null,
  job_id        uuid,
  ref           text,                              -- e.g. supplier invoice no.
  note          text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, material_id) references app.materials (tenant_id, id) on delete cascade,
  foreign key (tenant_id, warehouse_id) references app.warehouses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id) on delete set null (job_id)
);
create index on app.stock_movements (tenant_id, material_id, created_at desc);
create index on app.stock_movements (tenant_id, job_id);

-- Bill of materials per job (FR-4.5): what the job needs, what is held for it, what it took.
create table app.job_materials (
  tenant_id     uuid not null default app.tenant_id(),
  job_id        uuid not null,
  material_id   uuid not null,
  required_qty  numeric(16,3) not null check (required_qty >= 0),
  reserved_qty  numeric(16,3) not null default 0 check (reserved_qty >= 0),
  issued_qty    numeric(16,3) not null default 0,
  note          text,
  primary key (job_id, material_id),
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, material_id) references app.materials (tenant_id, id)
);
create index on app.job_materials (tenant_id, material_id);

-- Cost-bearing tables: admin / manager / executive only. Everyone else reads the masked views.
alter table app.stock_balances enable row level security;
alter table app.stock_movements enable row level security;
alter table app.job_materials enable row level security;
create policy cost_read on app.stock_balances for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_role('admin', 'manager', 'executive'));
create policy cost_read on app.stock_movements for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_role('admin', 'manager', 'executive'));
create policy tenant_read on app.job_materials for select to authenticated using (tenant_id = app.tenant_id());
grant select on app.stock_balances, app.stock_movements, app.job_materials to authenticated;
select audit.enable('app.job_materials');

-- Views run with the owner's rights, filter by the caller's tenant and blank costs for other roles.
create view app.stock_v as
select
  m.tenant_id, m.id as material_id, m.code, m.name, m.category, m.uom, m.purchase_uom, m.conversion_factor, m.min_stock,
  coalesce(b.on_hand, 0) as on_hand,
  coalesce(b.reserved, 0) as reserved,
  coalesce(b.on_hand, 0) - coalesce(b.reserved, 0) as available,
  coalesce((select sum(greatest(jm.required_qty - jm.issued_qty - jm.reserved_qty, 0))
            from app.job_materials jm join app.jobs j on j.id = jm.job_id
            where jm.material_id = m.id and j.status in ('approved', 'in_production', 'pending_approval', 'on_hold')), 0) as shortage,
  case when app.has_role('admin', 'manager', 'executive') then b.avg_cost end as avg_cost,
  coalesce(b.on_hand, 0) - coalesce(b.reserved, 0) < m.min_stock as below_min
from app.materials m
left join app.stock_balances b on b.material_id = m.id
where m.tenant_id = app.tenant_id() and m.deleted_at is null;

create view app.stock_movements_v as
select
  s.id, s.tenant_id, s.material_id, s.type, s.qty, s.balance_after, s.job_id, s.ref, s.note, s.created_by, s.created_at,
  case when app.has_role('admin', 'manager', 'executive') then s.unit_cost end as unit_cost,
  j.job_no
from app.stock_movements s
left join app.jobs j on j.id = s.job_id
where s.tenant_id = app.tenant_id();
grant select on app.stock_v, app.stock_movements_v to authenticated;

-- Core movement (FR-8.1/8.4/8.5). Receipts re-average cost; everything else moves at current average.
create function app.stock_move(
  p_tenant uuid, p_material uuid, p_type app.stock_move_type, p_qty numeric,
  p_unit_cost numeric default null, p_job uuid default null, p_ref text default null, p_note text default null
) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_wh   uuid;
  v_bal  app.stock_balances;
  v_cost numeric;
  v_id   bigint;
begin
  select id into v_wh from app.warehouses where tenant_id = p_tenant and is_default;
  if v_wh is null then
    perform app.fail('stock.no_warehouse');
  end if;
  if not exists (select 1 from app.materials where id = p_material and tenant_id = p_tenant and deleted_at is null) then
    perform app.fail('stock.material_not_found');
  end if;

  insert into app.stock_balances (tenant_id, material_id, warehouse_id)
  values (p_tenant, p_material, v_wh)
  on conflict (material_id, warehouse_id) do nothing;
  select * into v_bal from app.stock_balances where material_id = p_material and warehouse_id = v_wh for update;

  if v_bal.on_hand + p_qty < 0 then
    perform app.fail('stock.insufficient', format('Not enough stock: %s on hand', trim_scale(v_bal.on_hand)));
  end if;

  v_cost := case
    when p_type = 'receive' and p_qty > 0 then coalesce(p_unit_cost, v_bal.avg_cost)
    else v_bal.avg_cost end;

  update app.stock_balances
  set on_hand = on_hand + p_qty,
      avg_cost = case when p_type = 'receive' and p_qty > 0 and on_hand + p_qty > 0
                      then round((on_hand * avg_cost + p_qty * v_cost) / (on_hand + p_qty), 4)
                      else avg_cost end,
      updated_at = now()
  where material_id = p_material and warehouse_id = v_wh;

  insert into app.stock_movements (tenant_id, material_id, warehouse_id, type, qty, unit_cost, balance_after, job_id, ref, note)
  values (p_tenant, p_material, v_wh, p_type, p_qty, v_cost, v_bal.on_hand + p_qty, p_job, nullif(trim(p_ref), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end
$$;

-- Reserve what a job still needs from what is free (FR-8.2/8.3, G-08). Returns true when short.
create function app.reserve_for_job(p_job uuid) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_jm    app.job_materials;
  v_wh    uuid;
  v_free  numeric;
  v_want  numeric;
  v_new   numeric;
  v_short boolean := false;
begin
  for v_jm in select * from app.job_materials where job_id = p_job for update loop
    select id into v_wh from app.warehouses where tenant_id = v_jm.tenant_id and is_default;
    insert into app.stock_balances (tenant_id, material_id, warehouse_id)
    values (v_jm.tenant_id, v_jm.material_id, v_wh) on conflict (material_id, warehouse_id) do nothing;
    select on_hand - (reserved - v_jm.reserved_qty) into v_free
    from app.stock_balances where material_id = v_jm.material_id and warehouse_id = v_wh for update;

    v_want := greatest(v_jm.required_qty - v_jm.issued_qty, 0);
    v_new := least(v_want, greatest(v_free, 0));
    if v_new <> v_jm.reserved_qty then
      update app.stock_balances set reserved = reserved + (v_new - v_jm.reserved_qty), updated_at = now()
      where material_id = v_jm.material_id and warehouse_id = v_wh;
      update app.job_materials set reserved_qty = v_new where job_id = p_job and material_id = v_jm.material_id;
    end if;
    v_short := v_short or v_new < v_want;
  end loop;
  return v_short;
end
$$;

create function app.release_reservations(p_job uuid) returns void
language sql
set search_path = ''
as $$
  update app.stock_balances b set reserved = greatest(b.reserved - jm.reserved_qty, 0), updated_at = now()
  from app.job_materials jm, app.warehouses w
  where jm.job_id = p_job and jm.reserved_qty > 0 and b.material_id = jm.material_id
    and w.id = b.warehouse_id and w.is_default and w.tenant_id = jm.tenant_id;
  update app.job_materials set reserved_qty = 0 where job_id = p_job and reserved_qty > 0;
$$;

-- Reserve on approval; release when the job completes or is cancelled (FR-8.2).
create function app.on_job_reserve() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_short boolean;
begin
  if not app.module_enabled(new.tenant_id, 'inventory') then
    return new;
  end if;
  if new.status in ('approved', 'in_production') and old.status in ('planning', 'pending_approval') then
    v_short := app.reserve_for_job(new.id);
    if v_short then
      perform app.notify(new.tenant_id, app.members_with(new.tenant_id, '{manager,supervisor}'), 'stock_short',
        jsonb_build_object('job_no', new.job_no, 'title', new.title), '/inventory');
    end if;
  elsif new.status in ('completed', 'cancelled') and old.status not in ('completed', 'cancelled') then
    perform app.release_reservations(new.id);
  end if;
  return new;
end
$$;
create trigger reserve after update of status on app.jobs for each row execute function app.on_job_reserve();

-- Commands -------------------------------------------------------------------------

-- Goods receipt (FR-8.1). qty and unit cost are in stock units.
create function api.receive_stock(p_material uuid, p_qty numeric, p_unit_cost numeric, p_ref text default null, p_note text default null)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_job uuid;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  perform app.require_module('inventory');
  if coalesce(p_qty, 0) <= 0 or coalesce(p_unit_cost, -1) < 0 then
    perform app.fail('step.qty_invalid');
  end if;
  v_id := app.stock_move(app.tenant_id(), p_material, 'receive', p_qty, p_unit_cost, null, p_ref, p_note);
  -- New stock may cover jobs that were short.
  for v_job in
    select distinct jm.job_id from app.job_materials jm join app.jobs j on j.id = jm.job_id
    where jm.material_id = p_material and j.status in ('approved', 'in_production', 'pending_approval', 'on_hold')
      and jm.reserved_qty < jm.required_qty - jm.issued_qty
  loop
    perform app.reserve_for_job(v_job);
  end loop;
  return v_id;
end
$$;

-- Stock count correction with a reason (FR-8.1). p_new_on_hand is the counted quantity.
create function api.adjust_stock(p_material uuid, p_new_on_hand numeric, p_reason text) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_now numeric;
begin
  perform app.require_role('admin', 'manager');
  perform app.require_module('inventory');
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform app.fail('approval.reason_required');
  end if;
  if coalesce(p_new_on_hand, -1) < 0 then
    perform app.fail('step.qty_invalid');
  end if;
  select coalesce(sum(b.on_hand), 0) into v_now from app.stock_balances b
  where b.material_id = p_material and b.tenant_id = app.tenant_id();
  if p_new_on_hand < (select coalesce(sum(reserved), 0) from app.stock_balances where material_id = p_material) then
    perform app.fail('stock.below_reserved');
  end if;
  return app.stock_move(app.tenant_id(), p_material, 'adjust', p_new_on_hand - v_now, null, null, null, p_reason);
end
$$;

-- Issue to a job (FR-8.1); takes from the job's reservation first. Negative p_qty returns stock.
create function api.issue_material(p_job uuid, p_material uuid, p_qty numeric, p_note text default null) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job app.jobs;
  v_jm  app.job_materials;
  v_id  bigint;
  v_use numeric;
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  perform app.require_module('inventory');
  select * into v_job from app.jobs where id = p_job and tenant_id = app.tenant_id();
  if not found then
    perform app.fail('job.not_found');
  end if;
  if v_job.status not in ('approved', 'in_production', 'pending_approval', 'on_hold', 'ready_to_deliver') then
    perform app.fail('stock.job_not_active');
  end if;
  if coalesce(p_qty, 0) = 0 then
    perform app.fail('step.qty_invalid');
  end if;

  insert into app.job_materials (tenant_id, job_id, material_id, required_qty)
  values (v_job.tenant_id, p_job, p_material, 0)
  on conflict (job_id, material_id) do nothing;
  select * into v_jm from app.job_materials where job_id = p_job and material_id = p_material for update;
  if p_qty < 0 and v_jm.issued_qty + p_qty < 0 then
    perform app.fail('stock.return_over_issued');
  end if;

  -- Free the part of this job's reservation that the issue consumes, then move the stock.
  v_use := case when p_qty > 0 then least(p_qty, v_jm.reserved_qty) else 0 end;
  if v_use > 0 then
    update app.stock_balances b set reserved = greatest(b.reserved - v_use, 0)
    from app.warehouses w where b.material_id = p_material and w.id = b.warehouse_id and w.is_default and w.tenant_id = v_job.tenant_id;
  end if;
  v_id := app.stock_move(v_job.tenant_id, p_material, case when p_qty > 0 then 'issue' else 'return' end::app.stock_move_type,
                         -p_qty, null, p_job, null, p_note);
  update app.job_materials
  set issued_qty = issued_qty + p_qty, reserved_qty = reserved_qty - v_use
  where job_id = p_job and material_id = p_material;
  perform app.log_job(p_job, case when p_qty > 0 then 'material_issued' else 'material_returned' end,
                      jsonb_build_object('material_id', p_material, 'qty', abs(p_qty)));
  return v_id;
end
$$;

-- Replace a job's bill of materials (FR-4.5). p_items: [{"material_id", "required_qty", "note"?}]
create function api.set_job_materials(p_job uuid, p_items jsonb) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job app.jobs;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  perform app.require_module('inventory');
  select * into v_job from app.jobs where id = p_job and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('job.not_found');
  end if;
  if v_job.status in ('completed', 'cancelled') then
    perform app.fail('stock.job_not_active');
  end if;

  -- Drop lines no longer wanted (only if nothing was issued against them).
  if exists (
    select 1 from app.job_materials jm
    where jm.job_id = p_job and jm.issued_qty > 0
      and not exists (select 1 from jsonb_array_elements(p_items) x where (x ->> 'material_id')::uuid = jm.material_id)
  ) then
    perform app.fail('stock.issued_line_removed');
  end if;
  perform app.release_reservations(p_job);
  delete from app.job_materials jm
  where jm.job_id = p_job
    and not exists (select 1 from jsonb_array_elements(p_items) x where (x ->> 'material_id')::uuid = jm.material_id);

  insert into app.job_materials (tenant_id, job_id, material_id, required_qty, note)
  select v_job.tenant_id, p_job, (x ->> 'material_id')::uuid, (x ->> 'required_qty')::numeric, nullif(trim(x ->> 'note'), '')
  from jsonb_array_elements(p_items) x
  where exists (select 1 from app.materials m where m.id = (x ->> 'material_id')::uuid and m.tenant_id = v_job.tenant_id)
  on conflict (job_id, material_id) do update set required_qty = excluded.required_qty, note = excluded.note;

  if v_job.status in ('approved', 'in_production', 'pending_approval', 'on_hold') then
    return app.reserve_for_job(p_job);
  end if;
  return false;
end
$$;

-- Release with the stock gate (BR-R07). When the shop turns stock_gate on, a job that is short
-- needs a manager override with a reason; the override is logged.
drop function api.release_jobs(uuid[]);
create function api.release_jobs(p_jobs uuid[], p_override_reason text default null) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job   app.jobs;
  v_gate  boolean;
  v_short boolean;
  v_count int := 0;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  select coalesce((settings #>> '{features,stock_gate}')::boolean, false) and app.module_enabled(id, 'inventory')
    into v_gate from app.tenants where id = app.tenant_id();

  perform set_config('app.in_command', 'on', true);
  for v_job in
    select * from app.jobs
    where id = any (p_jobs) and tenant_id = app.tenant_id() and status = 'approved'
    order by due_date nulls last, created_at
    for update
  loop
    -- G-08: re-check and reserve at release (only for shops using inventory)
    v_short := case when app.module_enabled(v_job.tenant_id, 'inventory') then app.reserve_for_job(v_job.id) else false end;
    if v_gate and v_short then
      if coalesce(length(trim(p_override_reason)), 0) = 0 then
        perform app.fail('release.stock_short', 'Not enough material for ' || v_job.job_no);
      end if;
      if not app.has_role('manager') then
        perform app.fail('release.override_needs_manager');
      end if;
      perform app.log_job(v_job.id, 'stock_override', jsonb_build_object('reason', trim(p_override_reason)));
    end if;
    perform app.release_one(v_job.id);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    perform app.fail('release.nothing_approved');
  end if;
  perform app.reschedule(app.tenant_id());
  return v_count;
end
$$;

revoke execute on function
  api.receive_stock(uuid, numeric, numeric, text, text), api.adjust_stock(uuid, numeric, text),
  api.issue_material(uuid, uuid, numeric, text), api.set_job_materials(uuid, jsonb), api.release_jobs(uuid[], text)
from public, anon;
grant execute on function
  api.receive_stock(uuid, numeric, numeric, text, text), api.adjust_stock(uuid, numeric, text),
  api.issue_material(uuid, uuid, numeric, text), api.set_job_materials(uuid, jsonb), api.release_jobs(uuid[], text)
to authenticated;

-- Settings: allow the stock/proof gate switches.
create or replace function api.update_tenant_settings(p_name text default null, p_patch jsonb default '{}')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_set    jsonb;
  v_key    text;
begin
  perform app.require_role('admin');
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('allow_self_approval', 'timezone', 'overhead_pct', 'doc_numbering', 'features') then
      perform app.fail('settings.unknown_key', 'Unknown setting: ' || v_key);
    end if;
  end loop;
  if p_patch ? 'allow_self_approval' and jsonb_typeof(p_patch -> 'allow_self_approval') <> 'boolean' then
    perform app.fail('settings.invalid');
  end if;
  -- Gates (D-01/G-15): only the known boolean switches.
  if p_patch ? 'features' and (
       jsonb_typeof(p_patch -> 'features') <> 'object'
       or exists (select 1 from jsonb_each(p_patch -> 'features') f
                  where f.key not in ('stock_gate', 'proof_gate') or jsonb_typeof(f.value) <> 'boolean')) then
    perform app.fail('settings.invalid');
  end if;
  if p_patch ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p_patch ->> 'timezone') then
    perform app.fail('settings.invalid_timezone');
  end if;
  if p_patch ? 'overhead_pct' and ((p_patch ->> 'overhead_pct')::numeric < 0 or (p_patch ->> 'overhead_pct')::numeric > 500) then
    perform app.fail('settings.invalid');
  end if;
  if p_patch ? 'doc_numbering' and not (
       coalesce(p_patch #>> '{doc_numbering,year}', 'ad') in ('ad', 'be')
       and coalesce(p_patch #>> '{doc_numbering,reset}', 'yearly') in ('yearly', 'monthly')
       and coalesce((p_patch #>> '{doc_numbering,digits}')::int, 4) between 3 and 8) then
    perform app.fail('settings.invalid');
  end if;

  update app.tenants
  set name = coalesce(nullif(trim(p_name), ''), name),
      settings = settings || (p_patch - 'features')
                 || case when p_patch ? 'features'
                         then jsonb_build_object('features', coalesce(settings -> 'features', '{}') || (p_patch -> 'features'))
                         else '{}' end
  where id = v_tenant
  returning settings into v_set;
  return v_set;
end
$$;
