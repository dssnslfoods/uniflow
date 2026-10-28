-- Modules per shop (super admin): the core flow is always on; optional modules are switched
-- on per tenant because shops use the system differently. Enforced in the database (every
-- command of a module checks it) and mirrored in the UI (menus and pages hidden).
--   core (always): PO, planning & approval, board, shop floor, master data, overview, settings
--   outsource: outsource orders · delivery: deliveries · inventory: stock, BOM, stock gate
--   proof / costing / reports: reserved for upcoming modules

create function app.known_modules() returns text[]
language sql immutable
set search_path = ''
as $$ select array['outsource', 'delivery', 'inventory', 'proof', 'costing', 'reports'] $$;

alter table app.tenants
  add column modules text[] not null default array['outsource', 'delivery', 'inventory'],
  add constraint tenants_modules_known check (modules <@ app.known_modules());

create function app.module_enabled(p_tenant uuid, p_module text) returns boolean
language sql stable
set search_path = ''
as $$ select coalesce((select p_module = any (modules) from app.tenants where id = p_tenant), false) $$;

create function app.require_module(p_module text) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not app.module_enabled(app.tenant_id(), p_module) then
    perform app.fail('module.disabled', 'Module not enabled: ' || p_module);
  end if;
end
$$;

-- Platform admins choose each shop's modules; shops cannot change them (column not granted).
create function api.admin_set_modules(p_tenant uuid, p_modules text[]) returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_mods text[];
begin
  perform app.require_platform_admin();
  if not (coalesce(p_modules, '{}') <@ app.known_modules()) then
    perform app.fail('module.unknown');
  end if;
  update app.tenants set modules = (select coalesce(array_agg(distinct m order by m), '{}') from unnest(p_modules) m)
  where id = p_tenant
  returning modules into v_mods;
  if not found then
    perform app.fail('tenant.not_found');
  end if;
  return v_mods;
end
$$;
revoke execute on function api.admin_set_modules(uuid, text[]) from public, anon;
grant execute on function api.admin_set_modules(uuid, text[]) to authenticated;

-- Module checks in existing commands (receive/QC go through outsource_for_update).
create or replace function app.outsource_for_update(p_order uuid) returns app.outsource_orders
language plpgsql
set search_path = ''
as $$
declare
  v_order app.outsource_orders;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  perform app.require_module('outsource');
  select * into v_order from app.outsource_orders where id = p_order and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('outsource.not_found');
  end if;
  return v_order;
end
$$;

create or replace function api.send_outsource(
  p_step uuid, p_vendor uuid, p_qty numeric, p_expected_at timestamptz, p_cost numeric default null, p_note text default null
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
  if v_step.step_type <> 'outsource' then
    perform app.fail('outsource.not_outsource_step');
  end if;
  if v_step.status <> 'ready' then
    perform app.fail('step.not_ready');
  end if;
  if not exists (select 1 from app.jobs where id = v_step.job_id and status = 'in_production') then
    perform app.fail('step.job_not_released');
  end if;
  if not exists (select 1 from app.vendors where id = p_vendor and tenant_id = v_step.tenant_id and deleted_at is null) then
    perform app.fail('outsource.vendor_not_found');
  end if;
  if coalesce(p_qty, 0) <= 0 then
    perform app.fail('step.qty_invalid');
  end if;
  if p_expected_at is null or p_expected_at <= now() then
    perform app.fail('outsource.expected_in_past');
  end if;

  insert into app.outsource_orders (doc_no, job_step_id, vendor_id, qty_sent, expected_at, cost, note)
  values (app.next_doc_no('OS'), p_step, p_vendor, p_qty, p_expected_at, p_cost, nullif(trim(p_note), ''))
  returning id into v_id;

  perform set_config('app.in_command', 'on', true);
  update app.job_steps
  set status = 'in_progress', vendor_id = p_vendor, actual_start = coalesce(actual_start, now()), version = version + 1
  where id = p_step;
  insert into app.production_logs (tenant_id, job_step_id, action, reason)
  values (v_step.tenant_id, p_step, 'start', 'outsource ' || (select doc_no from app.outsource_orders where id = v_id));
  perform app.log_job(v_step.job_id, 'outsource_sent', jsonb_build_object('order_id', v_id, 'vendor_id', p_vendor));
  perform app.reschedule(v_step.tenant_id);
  return v_id;
end
$$;

create or replace function api.create_delivery(
  p_sales_order uuid, p_items jsonb, p_receiver text default null, p_note text default null,
  p_delivered_at timestamptz default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_so    app.sales_orders;
  v_id    uuid;
  v_item  jsonb;
  v_job   app.jobs;
  v_total numeric;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  perform app.require_module('delivery');
  select * into v_so from app.sales_orders where id = p_sales_order and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('order.not_found');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform app.fail('delivery.no_items');
  end if;

  insert into app.deliveries (doc_no, sales_order_id, delivered_at, receiver_name, address, note)
  values (app.next_doc_no('DO'), p_sales_order, coalesce(p_delivered_at, now()), nullif(trim(p_receiver), ''),
          v_so.delivery_info ->> 'address', nullif(trim(p_note), ''))
  returning id into v_id;

  perform set_config('app.in_command', 'on', true);
  for v_item in select * from jsonb_array_elements(p_items) loop
    continue when coalesce((v_item ->> 'qty')::numeric, 0) <= 0;
    select * into v_job from app.jobs where id = (v_item ->> 'job_id')::uuid and sales_order_id = p_sales_order for update;
    if not found then
      perform app.fail('delivery.job_not_in_order');
    end if;
    if v_job.status not in ('ready_to_deliver', 'partially_delivered') then
      perform app.fail('delivery.job_not_ready');
    end if;
    insert into app.delivery_items (tenant_id, delivery_id, job_id, qty)
    values (v_so.tenant_id, v_id, v_job.id, (v_item ->> 'qty')::numeric);

    select coalesce(sum(qty), 0) into v_total from app.delivery_items where job_id = v_job.id;
    if v_total > v_job.qty then
      perform app.fail('delivery.over_qty');
    end if;
    update app.jobs
    set status = case when v_total >= qty then 'completed' else 'partially_delivered' end::app.job_status,
        version = version + 1
    where id = v_job.id;
    perform app.log_job(v_job.id, 'delivered', jsonb_build_object('delivery_id', v_id, 'qty', (v_item ->> 'qty')::numeric));
  end loop;

  if not exists (select 1 from app.delivery_items where delivery_id = v_id) then
    perform app.fail('delivery.no_items');
  end if;

  -- The PO is delivered when every live job is complete (FR-9.3).
  if not exists (select 1 from app.jobs where sales_order_id = p_sales_order and status not in ('completed', 'cancelled')) then
    perform set_config('app.bypass_order_guard', 'on', true);
    update app.sales_orders set status = 'delivered' where id = p_sales_order;
    perform set_config('app.bypass_order_guard', 'off', true);
  end if;
  perform set_config('app.in_command', 'off', true);
  return v_id;
end
$$;

-- Platform console lists each shop's modules.
drop function api.admin_list_tenants();
create function api.admin_list_tenants()
returns table (
  tenant_id uuid, name text, plan_id text, status app.tenant_status, created_at timestamptz,
  members int, machines int, open_orders int, active_jobs int, owner_email text, supporting boolean,
  modules text[]
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return query
  select t.id, t.name, t.plan_id, t.status, t.created_at,
         (select count(*)::int from app.memberships m where m.tenant_id = t.id and m.is_active and not m.is_support),
         (select count(*)::int from app.machines x where x.tenant_id = t.id and x.deleted_at is null),
         (select count(*)::int from app.sales_orders o where o.tenant_id = t.id and o.status in ('draft', 'confirmed', 'in_progress')),
         (select count(*)::int from app.jobs j where j.tenant_id = t.id and j.status not in ('completed', 'cancelled')),
         (select u.email::text from app.memberships m join auth.users u on u.id = m.user_id
           where m.tenant_id = t.id and not m.is_support and 'admin' = any (m.roles) order by m.created_at limit 1),
         exists (select 1 from app.memberships m where m.tenant_id = t.id and m.user_id = auth.uid() and m.is_support and m.is_active),
         t.modules
  from app.tenants t
  order by t.created_at desc;
end
$$;

revoke execute on function api.admin_list_tenants() from public, anon;
grant execute on function api.admin_list_tenants() to authenticated;
