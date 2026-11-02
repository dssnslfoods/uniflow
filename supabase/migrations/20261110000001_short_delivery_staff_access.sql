-- Business rules decided after the UAT (D-24, D-25).

-- D-24: only good pieces can be delivered -------------------------------------------------
-- Good output of a job, in job units: what its last stage finished, with that stage's rework.
-- Steps may count other units (sheets), so each is scaled by its own plan. Parallel last steps
-- limit each other.
create function app.job_good_qty(p_job uuid) returns numeric
language sql stable
set search_path = ''
as $$
  with recursive finals as (
    select s.id, s.planned_qty
    from app.job_steps s
    where s.job_id = p_job and not s.is_rework and s.status <> 'skipped'
      and s.seq = (select max(x.seq) from app.job_steps x
                   where x.job_id = p_job and not x.is_rework and x.status <> 'skipped')
  ), tree as (
    select f.id as final_id, f.id from finals f
    union all
    select t.final_id, r.id
    from tree t
    join app.job_steps r on r.rework_of_step_id = t.id and r.status <> 'skipped'
  ), totals as (
    select f.id, f.planned_qty, sum(s.good_qty) as good
    from finals f
    join tree t on t.final_id = f.id
    join app.job_steps s on s.id = t.id
    group by f.id, f.planned_qty
  )
  select trunc(least(j.qty, coalesce(min(j.qty * t.good / nullif(t.planned_qty, 0)), j.qty)), 3)
  from app.jobs j
  left join totals t on true
  where j.id = p_job
  group by j.qty
$$;

create function api.job_good_qtys(p_jobs uuid[])
returns table (job_id uuid, good_qty numeric)
language sql stable security definer
set search_path = ''
as $$
  select j.id, app.job_good_qty(j.id)
  from app.jobs j
  where j.id = any (p_jobs) and j.tenant_id = app.tenant_id()
$$;

revoke execute on function api.job_good_qtys(uuid[]) from public, anon;
grant execute on function api.job_good_qtys(uuid[]) to authenticated;

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
    if v_total > app.job_good_qty(v_job.id) then
      perform app.fail('delivery.over_good');
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

-- A short job has nothing more to send: a manager closes it with the reason on record.
create function api.close_job_short(p_job uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job   app.jobs;
  v_total numeric;
begin
  perform app.require_role('admin', 'manager');
  perform app.require_module('delivery');
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform app.fail('approval.reason_required');
  end if;
  select * into v_job from app.jobs where id = p_job and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('job.not_found');
  end if;
  if v_job.status not in ('ready_to_deliver', 'partially_delivered') then
    perform app.fail('delivery.job_not_ready');
  end if;
  select coalesce(sum(qty), 0) into v_total from app.delivery_items where job_id = p_job;
  if v_total = 0 then
    perform app.fail('delivery.nothing_delivered');
  end if;

  perform set_config('app.in_command', 'on', true);
  update app.jobs set status = 'completed', version = version + 1 where id = p_job;
  perform set_config('app.in_command', 'off', true);
  perform app.log_job(p_job, 'closed_short', jsonb_build_object('reason', trim(p_reason), 'delivered', v_total, 'qty', v_job.qty));

  if not exists (select 1 from app.jobs where sales_order_id = v_job.sales_order_id and status not in ('completed', 'cancelled')) then
    perform set_config('app.bypass_order_guard', 'on', true);
    update app.sales_orders set status = 'delivered' where id = v_job.sales_order_id;
    perform set_config('app.bypass_order_guard', 'off', true);
  end if;
end
$$;

revoke execute on function api.close_job_short(uuid, text) from public, anon;
grant execute on function api.close_job_short(uuid, text) to authenticated;

-- D-25: selling prices and the executive dashboard are not for Staff (SRS §10) -------------
-- Staff still reads order lines for job cards, so the price column alone is withdrawn:
-- every role reads it through this view, which leaves Staff out. Writes are unchanged.
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_cols
  from information_schema.columns
  where table_schema = 'app' and table_name = 'sales_order_items' and column_name <> 'unit_price';
  revoke select on app.sales_order_items from authenticated;
  execute format('grant select (%s) on app.sales_order_items to authenticated', v_cols);
end
$$;

create view app.sales_order_item_prices_v with (security_barrier = true) as
select i.tenant_id, i.id, i.sales_order_id, i.qty, i.unit_price
from app.sales_order_items i
where i.tenant_id = app.tenant_id() and app.has_role('admin', 'executive', 'manager', 'supervisor');
grant select on app.sales_order_item_prices_v to authenticated;

alter function api.dashboard_summary() set schema app;
alter function app.dashboard_summary() rename to dashboard_summary_data;
revoke execute on function app.dashboard_summary_data() from public, anon, authenticated;

create function api.dashboard_summary() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_role('admin', 'executive', 'manager', 'supervisor');
  return app.dashboard_summary_data();
end
$$;

revoke execute on function api.dashboard_summary() from public, anon;
grant execute on function api.dashboard_summary() to authenticated;
