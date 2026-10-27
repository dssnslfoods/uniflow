-- Orders (M3, D-09, D-13): a customer-confirmed PO becomes a Sales Order with line items.
-- Draft SOs are edited directly (RLS); status changes go through api.* only.

create type app.sales_order_status as enum ('draft', 'confirmed', 'in_progress', 'delivered', 'closed', 'cancelled');

create table app.sales_orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default app.tenant_id() references app.tenants on delete cascade,
  doc_no           text not null,
  customer_id      uuid not null,
  customer_po_no   text not null check (length(trim(customer_po_no)) > 0),
  po_date          date not null default current_date,
  due_date         date,
  delivery_info    jsonb not null default '{}'::jsonb,   -- {address, contact, phone, note}
  po_file_path     text,                                 -- storage: po-files/<tenant>/<so id>/<file>
  status           app.sales_order_status not null default 'draft',
  note             text,
  confirmed_at     timestamptz,
  confirmed_by     uuid,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  unique (tenant_id, id),
  unique (tenant_id, doc_no),
  unique (tenant_id, customer_id, customer_po_no),
  foreign key (tenant_id, customer_id) references app.customers (tenant_id, id)
);
create index on app.sales_orders (tenant_id, status, due_date);

create table app.sales_order_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default app.tenant_id(),
  sales_order_id  uuid not null,
  line_no         smallint not null check (line_no > 0),
  description     text not null check (length(trim(description)) > 0),
  spec            jsonb not null default '{}'::jsonb,   -- {size, paper, colors, finishing}
  qty             numeric(14,3) not null check (qty > 0),
  uom             text not null default 'ชิ้น',
  unit_price      numeric(14,4) not null default 0 check (unit_price >= 0),
  due_date        date,                                  -- null = sales order due date
  note            text,
  unique (tenant_id, id),
  unique (sales_order_id, line_no) deferrable initially deferred,
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id) on delete cascade
);

-- SO number from the tenant's running sequence (BR-R10).
create function app.sales_orders_defaults() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.doc_no := app.next_doc_no('SO');
  new.status := 'draft';
  return new;
end
$$;
create trigger defaults before insert on app.sales_orders
  for each row execute function app.sales_orders_defaults();

-- Only drafts are editable outside api.*; doc_no never changes.
create function app.sales_orders_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.doc_no is distinct from old.doc_no then
    perform app.fail('order.doc_no_immutable');
  end if;
  if current_setting('app.bypass_order_guard', true) is distinct from 'on' then
    if old.status <> 'draft' then
      perform app.fail('order.not_draft');
    end if;
    if new.status is distinct from old.status then
      perform app.fail('order.status_via_api');
    end if;
  end if;
  return new;
end
$$;
create trigger guard before update on app.sales_orders
  for each row execute function app.sales_orders_guard();

create function app.sales_order_items_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status app.sales_order_status;
begin
  select status into v_status from app.sales_orders
  where id = coalesce(new.sales_order_id, old.sales_order_id);
  if v_status is distinct from 'draft' and current_setting('app.bypass_order_guard', true) is distinct from 'on' then
    perform app.fail('order.not_draft');
  end if;
  return coalesce(new, old);
end
$$;
create trigger guard before insert or update or delete on app.sales_order_items
  for each row execute function app.sales_order_items_guard();

-- Policies: PO intake by supervisor/manager (D-17); everyone in the tenant may read.
select app.apply_tenant_policies('app.sales_orders', '{admin,manager,supervisor}');
select app.apply_tenant_policies('app.sales_order_items', '{admin,manager,supervisor}', true);
create policy tenant_delete_draft on app.sales_orders for delete to authenticated
  using (tenant_id = app.tenant_id() and app.has_role('admin', 'manager', 'supervisor') and status = 'draft');
grant delete on app.sales_orders to authenticated;

select app.add_standard_triggers('app.sales_orders');
select audit.enable('app.sales_order_items');

-- Commands -------------------------------------------------------------------

create function api.confirm_sales_order(p_order uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order app.sales_orders;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  select * into v_order from app.sales_orders
  where id = p_order and tenant_id = app.tenant_id()
  for update;
  if not found then
    perform app.fail('order.not_found');
  end if;
  if v_order.status <> 'draft' then
    perform app.fail('order.not_draft');
  end if;
  if not exists (select 1 from app.sales_order_items where sales_order_id = p_order) then
    perform app.fail('order.no_items');
  end if;
  if v_order.due_date is null
     and exists (select 1 from app.sales_order_items where sales_order_id = p_order and due_date is null) then
    perform app.fail('order.due_date_required');
  end if;

  perform set_config('app.bypass_order_guard', 'on', true);
  update app.sales_orders
  set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
  where id = p_order;
  perform set_config('app.bypass_order_guard', 'off', true);
end
$$;

-- Back to draft for corrections; only while no production work exists (jobs arrive in Sprint 3).
create function api.reopen_sales_order(p_order uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  perform app.require_role('admin', 'manager');
  perform set_config('app.bypass_order_guard', 'on', true);
  update app.sales_orders
  set status = 'draft', confirmed_at = null, confirmed_by = null
  where id = p_order and tenant_id = app.tenant_id() and status = 'confirmed';
  get diagnostics v_rows = row_count;   -- before perform, which resets FOUND
  perform set_config('app.bypass_order_guard', 'off', true);
  if v_rows = 0 then
    perform app.fail('order.not_reopenable');
  end if;
end
$$;

create function api.cancel_sales_order(p_order uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  perform app.require_role('admin', 'manager');
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform app.fail('order.reason_required');
  end if;
  perform set_config('app.bypass_order_guard', 'on', true);
  update app.sales_orders
  set status = 'cancelled', note = concat_ws(E'\n', note, 'ยกเลิก: ' || trim(p_reason))
  where id = p_order and tenant_id = app.tenant_id() and status in ('draft', 'confirmed');
  get diagnostics v_rows = row_count;
  perform set_config('app.bypass_order_guard', 'off', true);
  if v_rows = 0 then
    perform app.fail('order.not_cancellable');
  end if;
end
$$;

revoke execute on function api.confirm_sales_order(uuid), api.reopen_sales_order(uuid),
  api.cancel_sales_order(uuid, text) from public, anon;
grant execute on function api.confirm_sales_order(uuid), api.reopen_sales_order(uuid),
  api.cancel_sales_order(uuid, text) to authenticated;

-- PO files (Storage). Path: <tenant_id>/<sales_order_id>/<file>. Skipped where Storage is absent (local tests).
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('po-files', 'po-files', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg'])
  on conflict (id) do nothing;

  create policy po_files_read on storage.objects for select to authenticated
    using (bucket_id = 'po-files' and (storage.foldername(name))[1] = app.tenant_id()::text);
  create policy po_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'po-files' and (storage.foldername(name))[1] = app.tenant_id()::text
                and app.has_role('admin', 'manager', 'supervisor'));
  create policy po_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'po-files' and (storage.foldername(name))[1] = app.tenant_id()::text
           and app.has_role('admin', 'manager', 'supervisor'));
end
$$;
