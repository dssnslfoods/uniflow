-- Master data (M1): calendars, processes, machines, customers, vendors, materials, workflow templates.
-- Pattern: every table has tenant_id (defaulted from JWT) + unique (tenant_id, id) so children
-- reference parents with composite FKs and can never point across tenants.

-- Standard tenant policies. write_roles may insert/update; delete only when allow_delete
-- (master data with history is soft-deleted via deleted_at, BR-R08).
create function app.apply_tenant_policies(
  p_table        regclass,
  p_write_roles  app.role[],
  p_allow_delete boolean default false,
  p_read_roles   app.role[] default null      -- null = every member may read
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_read  text := case when p_read_roles is null
                       then 'tenant_id = app.tenant_id()'
                       else format('tenant_id = app.tenant_id() and app.has_role(variadic %L::app.role[])', p_read_roles)
                  end;
  v_write text := format('tenant_id = app.tenant_id() and app.has_role(variadic %L::app.role[])', p_write_roles);
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create policy tenant_read on %s for select to authenticated using (%s)', p_table, v_read);
  execute format('create policy tenant_insert on %s for insert to authenticated with check (%s)', p_table, v_write);
  execute format('create policy tenant_update on %s for update to authenticated using (%s) with check (%s)', p_table, v_write, v_write);
  execute format('grant select, insert, update on %s to authenticated', p_table);
  if p_allow_delete then
    execute format('create policy tenant_delete on %s for delete to authenticated using (%s)', p_table, v_write);
    execute format('grant delete on %s to authenticated', p_table);
  end if;
end
$$;

create function app.add_standard_triggers(p_table regclass) returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('create trigger touch before update on %s for each row execute function app.touch_updated()', p_table);
  perform audit.enable(p_table);
end
$$;

-- Calendars (FR-1.7) ---------------------------------------------------------

create table app.calendars (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app.tenant_id() references app.tenants on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (tenant_id, id),
  unique (tenant_id, name)
);
create unique index calendars_one_default on app.calendars (tenant_id) where is_default;

create table app.calendar_shifts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app.tenant_id(),
  calendar_id  uuid not null,
  weekday      smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time   time not null,
  end_time     time not null check (end_time > start_time),
  foreign key (tenant_id, calendar_id) references app.calendars (tenant_id, id) on delete cascade
);
create index on app.calendar_shifts (tenant_id, calendar_id, weekday);

create table app.holidays (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app.tenant_id() references app.tenants on delete cascade,
  calendar_id  uuid,                                   -- null = applies to every calendar
  day          date not null,
  name         text not null,
  foreign key (tenant_id, calendar_id) references app.calendars (tenant_id, id) on delete cascade
);
create unique index on app.holidays (tenant_id, coalesce(calendar_id, '00000000-0000-0000-0000-000000000000'::uuid), day);

-- Processes (FR-1.3) ---------------------------------------------------------

create table app.processes (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null default app.tenant_id() references app.tenants on delete cascade,
  code                       text not null,
  name                       text not null,
  step_type                  app.step_type not null,
  capacity_unit              app.capacity_unit not null default 'sheet',
  default_setup_min          numeric(8,2) not null default 0 check (default_setup_min >= 0),
  default_running_waste_pct  numeric(5,2) not null default 0 check (default_running_waste_pct between 0 and 100),
  default_crew_size          smallint not null default 1 check (default_crew_size >= 0),
  sort_order                 int not null default 0,
  deleted_at                 timestamptz,
  created_at                 timestamptz not null default now(),
  created_by                 uuid default auth.uid(),
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid,
  unique (tenant_id, id),
  unique (tenant_id, code)
);

-- Machines (FR-1.2) ----------------------------------------------------------

create table app.machines (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null default app.tenant_id() references app.tenants on delete cascade,
  code                   text not null,
  name                   text not null,
  machine_type           text,
  capacity_unit          app.capacity_unit not null default 'sheet',
  max_cap_per_hour       numeric(12,2) not null check (max_cap_per_hour > 0),
  setup_min              numeric(8,2) not null default 0 check (setup_min >= 0),
  efficiency_pct         numeric(5,2) not null default 85 check (efficiency_pct > 0 and efficiency_pct <= 100),
  makeready_waste_units  numeric(12,2) not null default 0 check (makeready_waste_units >= 0),
  crew_size              smallint not null default 1 check (crew_size >= 0),
  calendar_id            uuid,
  status                 app.machine_status not null default 'active',
  sort_order             int not null default 0,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  created_by             uuid default auth.uid(),
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  unique (tenant_id, id),
  unique (tenant_id, code),
  foreign key (tenant_id, calendar_id) references app.calendars (tenant_id, id)
);

-- Cost lives apart so Supervisor/Staff never receive it (RBAC: cost/margin).
create table app.machine_costs (
  machine_id     uuid primary key,
  tenant_id      uuid not null default app.tenant_id(),
  cost_per_hour  numeric(12,2) not null check (cost_per_hour >= 0),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  foreign key (tenant_id, machine_id) references app.machines (tenant_id, id) on delete cascade
);

create table app.machine_processes (
  tenant_id   uuid not null default app.tenant_id(),
  machine_id  uuid not null,
  process_id  uuid not null,
  primary key (machine_id, process_id),
  foreign key (tenant_id, machine_id) references app.machines (tenant_id, id) on delete cascade,
  foreign key (tenant_id, process_id) references app.processes (tenant_id, id) on delete cascade
);
create index on app.machine_processes (tenant_id, process_id);

create function app.machines_plan_limit() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Callers without write rights are rejected by RLS; let that error surface instead.
  if app.has_role('admin', 'manager') then
    perform app.assert_plan_limit(new.tenant_id, 'machines');
  end if;
  return new;
end
$$;
create trigger plan_limit before insert on app.machines
  for each row execute function app.machines_plan_limit();

-- Staff skills + shift (labor capacity, D-20) --------------------------------

alter table app.memberships add column calendar_id uuid,
  add foreign key (tenant_id, calendar_id) references app.calendars (tenant_id, id);

create table app.member_skills (
  tenant_id      uuid not null default app.tenant_id(),
  membership_id  uuid not null,
  process_id     uuid not null,
  primary key (membership_id, process_id),
  foreign key (tenant_id, membership_id) references app.memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, process_id) references app.processes (tenant_id, id) on delete cascade
);

-- Customers (FR-1.1) ---------------------------------------------------------

create table app.customers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default app.tenant_id() references app.tenants on delete cascade,
  code              text not null,
  name              text not null,
  tax_id            text,
  credit_term_days  int not null default 0 check (credit_term_days >= 0),
  contacts          jsonb not null default '[]'::jsonb,   -- [{name, phone, email, line_id}]
  addresses         jsonb not null default '[]'::jsonb,   -- [{label, address, is_default}]
  note              text,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id),
  unique (tenant_id, code)
);

-- Vendors (FR-1.5) -----------------------------------------------------------

create table app.vendors (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app.tenant_id() references app.tenants on delete cascade,
  code        text not null,
  name        text not null,
  contacts    jsonb not null default '[]'::jsonb,
  rating      numeric(3,2) check (rating between 0 and 5),
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create table app.vendor_services (
  tenant_id       uuid not null default app.tenant_id(),
  vendor_id       uuid not null,
  process_id      uuid not null,
  lead_time_days  numeric(5,1) not null default 1 check (lead_time_days >= 0),
  primary key (vendor_id, process_id),
  foreign key (tenant_id, vendor_id) references app.vendors (tenant_id, id) on delete cascade,
  foreign key (tenant_id, process_id) references app.processes (tenant_id, id) on delete cascade
);

-- Materials (FR-1.6, D-08: single warehouse, warehouse_id kept for later) ----

create table app.warehouses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app.tenant_id() references app.tenants on delete cascade,
  code        text not null,
  name        text not null,
  is_default  boolean not null default false,
  unique (tenant_id, id),
  unique (tenant_id, code)
);
create unique index warehouses_one_default on app.warehouses (tenant_id) where is_default;

create table app.materials (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default app.tenant_id() references app.tenants on delete cascade,
  code               text not null,
  name               text not null,
  category           text not null default 'paper' check (category in ('paper', 'ink', 'plate', 'consumable', 'other')),
  uom                text not null,                     -- stock unit, e.g. แผ่น
  purchase_uom       text,                              -- e.g. รีม
  conversion_factor  numeric(12,4) not null default 1 check (conversion_factor > 0),  -- stock units per purchase unit
  min_stock          numeric(14,3) not null default 0 check (min_stock >= 0),
  spec               jsonb not null default '{}'::jsonb, -- {gsm, width_mm, height_mm, color}
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create table app.material_costs (
  material_id  uuid primary key,
  tenant_id    uuid not null default app.tenant_id(),
  std_cost     numeric(14,4) not null check (std_cost >= 0),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  foreign key (tenant_id, material_id) references app.materials (tenant_id, id) on delete cascade
);

-- Workflow templates (FR-1.4) ------------------------------------------------

create table app.workflow_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app.tenant_id() references app.tenants on delete cascade,
  name         text not null,
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table app.workflow_template_steps (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default app.tenant_id(),
  template_id         uuid not null,
  seq                 smallint not null check (seq > 0),  -- equal seq = parallel steps (D-07)
  process_id          uuid not null,
  default_machine_id  uuid,
  note                text,
  foreign key (tenant_id, template_id) references app.workflow_templates (tenant_id, id) on delete cascade,
  foreign key (tenant_id, process_id) references app.processes (tenant_id, id),
  foreign key (tenant_id, default_machine_id) references app.machines (tenant_id, id)
);
create index on app.workflow_template_steps (tenant_id, template_id, seq);

-- Policies (RBAC matrix §10: master data CRUD = admin, R/U = manager) ---------

select app.apply_tenant_policies('app.calendars',          '{admin,manager}');
select app.apply_tenant_policies('app.calendar_shifts',    '{admin,manager}', true);
select app.apply_tenant_policies('app.holidays',           '{admin,manager}', true);
select app.apply_tenant_policies('app.processes',          '{admin,manager}');
select app.apply_tenant_policies('app.machines',           '{admin,manager}');
select app.apply_tenant_policies('app.machine_costs',      '{admin,manager}', false, '{admin,executive,manager}');
select app.apply_tenant_policies('app.machine_processes',  '{admin,manager}', true);
select app.apply_tenant_policies('app.member_skills',      '{admin,manager,supervisor}', true);
select app.apply_tenant_policies('app.customers',          '{admin,manager,supervisor}');
select app.apply_tenant_policies('app.vendors',            '{admin,manager,supervisor}');
select app.apply_tenant_policies('app.vendor_services',    '{admin,manager,supervisor}', true);
select app.apply_tenant_policies('app.warehouses',         '{admin}');
select app.apply_tenant_policies('app.materials',          '{admin,manager}');
select app.apply_tenant_policies('app.material_costs',     '{admin,manager}', false, '{admin,executive,manager}');
-- Supervisors design flows (D-16).
select app.apply_tenant_policies('app.workflow_templates', '{admin,manager,supervisor}');
select app.apply_tenant_policies('app.workflow_template_steps', '{admin,manager,supervisor}', true);

-- Staff/supervisor need to change machine status (maintenance) but not specs (G-23): done via api later.

select app.add_standard_triggers('app.calendars');
select app.add_standard_triggers('app.processes');
select app.add_standard_triggers('app.machines');
select app.add_standard_triggers('app.customers');
select app.add_standard_triggers('app.vendors');
select app.add_standard_triggers('app.materials');
select app.add_standard_triggers('app.workflow_templates');
select audit.enable('app.machine_costs');
select audit.enable('app.material_costs');

create index on app.machines (tenant_id, status) where deleted_at is null;
