-- Phase 2, part 1: outsource orders (FR-7.1–7.4) and deliveries (FR-9.1–9.3).
-- Outsource: send → receive → QC; the outsource step runs while the work is at the vendor.
-- Delivery: partial deliveries per job; a fully delivered job completes, then its PO.

create type app.outsource_status as enum ('sent', 'received', 'qc_passed', 'rejected', 'cancelled');

create table app.outsource_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app.tenant_id() references app.tenants on delete cascade,
  doc_no        text not null,
  job_step_id   uuid not null,
  vendor_id     uuid not null,
  qty_sent      numeric(14,3) not null check (qty_sent > 0),
  sent_at       timestamptz not null default now(),
  expected_at   timestamptz not null,
  received_at   timestamptz,
  qty_received  numeric(14,3),
  qty_rejected  numeric(14,3) not null default 0,
  cost          numeric(14,2) check (cost >= 0),
  status        app.outsource_status not null default 'sent',
  note          text,
  qc_note       text,
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (tenant_id, id),
  unique (tenant_id, doc_no),
  foreign key (tenant_id, job_step_id) references app.job_steps (tenant_id, id) on delete cascade,
  foreign key (tenant_id, vendor_id) references app.vendors (tenant_id, id)
);
create index on app.outsource_orders (tenant_id, status, expected_at);
create index on app.outsource_orders (tenant_id, vendor_id, sent_at);
-- One open order per step.
create unique index outsource_orders_one_open on app.outsource_orders (job_step_id) where status in ('sent', 'received');

create table app.deliveries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default app.tenant_id() references app.tenants on delete cascade,
  doc_no          text not null,
  sales_order_id  uuid not null,
  delivered_at    timestamptz not null default now(),
  receiver_name   text,
  address         text,
  note            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, doc_no),
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id)
);
create index on app.deliveries (tenant_id, sales_order_id, delivered_at desc);

create table app.delivery_items (
  tenant_id    uuid not null default app.tenant_id(),
  delivery_id  uuid not null,
  job_id       uuid not null,
  qty          numeric(14,3) not null check (qty > 0),
  primary key (delivery_id, job_id),
  foreign key (tenant_id, delivery_id) references app.deliveries (tenant_id, id) on delete cascade,
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id)
);
create index on app.delivery_items (tenant_id, job_id);

-- Read for everyone in the tenant; writes only through api.*.
alter table app.outsource_orders enable row level security;
alter table app.deliveries enable row level security;
alter table app.delivery_items enable row level security;
create policy tenant_read on app.outsource_orders for select to authenticated using (tenant_id = app.tenant_id());
create policy tenant_read on app.deliveries for select to authenticated using (tenant_id = app.tenant_id());
create policy tenant_read on app.delivery_items for select to authenticated using (tenant_id = app.tenant_id());
grant select on app.outsource_orders, app.deliveries, app.delivery_items to authenticated;
select audit.enable('app.outsource_orders');
select audit.enable('app.deliveries');

-- Shared by the floor and outsource QC: mark a step done, advance the job, reschedule.
create function app.finish_step(p_step uuid, p_good numeric, p_waste numeric, p_reason text) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_step app.job_steps;
  v_done boolean;
begin
  select * into v_step from app.job_steps where id = p_step;
  perform set_config('app.in_command', 'on', true);
  update app.job_steps
  set status = 'done', actual_end = now(),
      run_minutes = run_minutes + case when status = 'in_progress'
                                       then extract(epoch from now() - coalesce(resumed_at, now())) / 60 else 0 end,
      resumed_at = null, good_qty = p_good, waste_qty = coalesce(p_waste, 0), version = version + 1
  where id = p_step;
  insert into app.production_logs (tenant_id, job_step_id, action, good_qty, waste_qty, reason, machine_id)
  values (v_step.tenant_id, p_step, 'complete', p_good, coalesce(p_waste, 0), nullif(trim(p_reason), ''), v_step.machine_id);
  perform app.log_job(v_step.job_id, 'step_complete',
    jsonb_build_object('step_id', p_step, 'good', p_good, 'waste', coalesce(p_waste, 0)));
  perform app.refresh_readiness(v_step.job_id);

  v_done := not exists (select 1 from app.job_steps where job_id = v_step.job_id and status not in ('done', 'skipped'));
  if v_done then
    update app.jobs set status = 'ready_to_deliver', version = version + 1 where id = v_step.job_id and status = 'in_production';
    perform app.log_job(v_step.job_id, 'production_finished');
  end if;
  perform app.reschedule(v_step.tenant_id);
  return v_done;
end
$$;

-- Outsource commands ----------------------------------------------------------------

-- Send work out (FR-7.1): the outsource step starts and returns on the promised date.
create function api.send_outsource(
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

create function app.outsource_for_update(p_order uuid) returns app.outsource_orders
language plpgsql
set search_path = ''
as $$
declare
  v_order app.outsource_orders;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  select * into v_order from app.outsource_orders where id = p_order and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('outsource.not_found');
  end if;
  return v_order;
end
$$;

-- Goods back from the vendor (FR-7.2/7.3). Actual cost may be filled here.
create function api.receive_outsource(p_order uuid, p_qty numeric, p_cost numeric default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order app.outsource_orders := app.outsource_for_update(p_order);
begin
  if v_order.status <> 'sent' then
    perform app.fail('outsource.not_sent');
  end if;
  if coalesce(p_qty, -1) < 0 then
    perform app.fail('step.qty_invalid');
  end if;
  update app.outsource_orders
  set status = 'received', received_at = now(), qty_received = p_qty, cost = coalesce(p_cost, cost),
      updated_at = now(), updated_by = auth.uid()
  where id = p_order;
  perform app.reschedule(v_order.tenant_id);
end
$$;

-- QC of returned work: pass finishes the step (good = received − rejected); reject sends the
-- step back to "ready" so it can be sent again, and counts against the vendor (FR-7.4).
create function api.qc_outsource(p_order uuid, p_passed boolean, p_rejected numeric default 0, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order app.outsource_orders := app.outsource_for_update(p_order);
  v_step  app.job_steps;
  v_done  boolean := false;
begin
  if v_order.status <> 'received' then
    perform app.fail('outsource.not_received');
  end if;
  if coalesce(p_rejected, 0) < 0 or coalesce(p_rejected, 0) > v_order.qty_received then
    perform app.fail('step.qty_invalid');
  end if;
  select * into v_step from app.job_steps where id = v_order.job_step_id;

  update app.outsource_orders
  set status = case when p_passed then 'qc_passed' else 'rejected' end::app.outsource_status,
      qty_rejected = case when p_passed then coalesce(p_rejected, 0) else v_order.qty_received end,
      qc_note = nullif(trim(p_note), ''), updated_at = now(), updated_by = auth.uid()
  where id = p_order;

  if p_passed then
    v_done := app.finish_step(v_step.id, v_order.qty_received - coalesce(p_rejected, 0), coalesce(p_rejected, 0), p_note);
  else
    if coalesce(length(trim(p_note)), 0) = 0 then
      perform app.fail('approval.reason_required');
    end if;
    perform set_config('app.in_command', 'on', true);
    update app.job_steps set status = 'ready', version = version + 1 where id = v_step.id;
    perform app.log_job(v_step.job_id, 'outsource_rejected', jsonb_build_object('order_id', p_order, 'reason', trim(p_note)));
    perform app.reschedule(v_order.tenant_id);
  end if;
  return jsonb_build_object('job_done', v_done);
end
$$;

-- Vendor track record (FR-7.4): on-time and rejection rates from finished orders.
create view app.vendor_performance_v with (security_invoker = true) as
select
  v.tenant_id, v.id as vendor_id, v.name,
  count(o.id) filter (where o.status in ('qc_passed', 'rejected')) as orders_done,
  count(o.id) filter (where o.status in ('sent', 'received')) as orders_open,
  count(o.id) filter (where o.status = 'sent' and o.expected_at < now()) as orders_late_now,
  round(100.0 * count(o.id) filter (where o.status in ('qc_passed', 'rejected') and o.received_at <= o.expected_at)
        / nullif(count(o.id) filter (where o.status in ('qc_passed', 'rejected')), 0), 1) as on_time_pct,
  round(100.0 * sum(o.qty_rejected) filter (where o.status in ('qc_passed', 'rejected'))
        / nullif(sum(o.qty_received) filter (where o.status in ('qc_passed', 'rejected')), 0), 1) as reject_pct,
  sum(o.cost) filter (where o.sent_at > now() - interval '90 days') as cost_90d
from app.vendors v
left join app.outsource_orders o on o.vendor_id = v.id
where v.deleted_at is null
group by v.tenant_id, v.id, v.name;
grant select on app.vendor_performance_v to authenticated;

-- Late outsource work alerts supervisors and managers once a day per order (FR-7.3).
create function app.notify_overdue_outsource() returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count int := 0;
begin
  for v_row in
    select o.tenant_id, o.id, o.doc_no, v.name as vendor
    from app.outsource_orders o join app.vendors v on v.id = o.vendor_id
    where o.status = 'sent' and o.expected_at < now()
  loop
    continue when exists (
      select 1 from app.notifications
      where tenant_id = v_row.tenant_id and kind = 'outsource_overdue' and params ->> 'doc_no' = v_row.doc_no
        and created_at > now() - interval '24 hours');
    insert into app.notifications (tenant_id, user_id, kind, params, link)
    select v_row.tenant_id, u, 'outsource_overdue', jsonb_build_object('doc_no', v_row.doc_no, 'vendor', v_row.vendor), '/outsource'
    from unnest(app.members_with(v_row.tenant_id, '{manager,supervisor}')) u;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke execute on function app.notify_overdue_outsource() from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('uniflow-outsource-overdue', '30 * * * *', 'select app.notify_overdue_outsource()');
  end if;
end
$$;

-- Delivery commands -------------------------------------------------------------------

-- Deliver finished jobs of one PO (FR-9.1/9.2); partial quantities allowed.
-- p_items: [{"job_id": "...", "qty": 1000}]
create function api.create_delivery(
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

revoke execute on function
  api.send_outsource(uuid, uuid, numeric, timestamptz, numeric, text), api.receive_outsource(uuid, numeric, numeric),
  api.qc_outsource(uuid, boolean, numeric, text), api.create_delivery(uuid, jsonb, text, text, timestamptz)
from public, anon;
grant execute on function
  api.send_outsource(uuid, uuid, numeric, timestamptz, numeric, text), api.receive_outsource(uuid, numeric, numeric),
  api.qc_outsource(uuid, boolean, numeric, text), api.create_delivery(uuid, jsonb, text, text, timestamptz)
to authenticated;

-- Realtime board refresh for outsource changes.
do $$
begin
  if to_regproc('realtime.send') is not null then
    create trigger broadcast after insert or update on app.outsource_orders for each statement execute function app.broadcast_board();
  end if;
end
$$;

-- Scheduler: outsource steps return on the order's promised (or actual) date.
create or replace function app.reschedule(p_tenant uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tz       text := app.tenant_tz(p_tenant);
  v_default  uuid := app.default_calendar(p_tenant);
  v_now      timestamptz := now();
  v_changed  boolean;
  v_machine  record;
  v_step     app.job_steps;
  v_cursor   timestamptz;
  v_earliest timestamptz;
  v_start    timestamptz;
  v_end      timestamptz;
  v_lead     numeric;
begin
  if v_default is null then
    return;
  end if;
  perform set_config('app.in_command', 'on', true);

  for pass in 1..8 loop
    v_changed := false;

    for v_machine in
      select m.id, coalesce(m.calendar_id, v_default) as cal
      from app.machines m where m.tenant_id = p_tenant and m.deleted_at is null
    loop
      v_cursor := v_now;
      for v_step in
        select s.* from app.job_steps s join app.jobs j on j.id = s.job_id
        where s.machine_id = v_machine.id and app.on_floor(j.status, j.released_at)
          and s.status in ('pending', 'ready', 'in_progress', 'paused')
        order by (s.status = 'in_progress') desc, (s.status = 'paused') desc, s.queue_position nulls last, s.id
      loop
        if v_step.status = 'in_progress' then
          select w.end_at into v_end from app.schedule_window(v_machine.cal, v_tz, v_now, app.remaining_minutes(v_step, v_now)) w;
          v_start := coalesce(v_step.actual_start, v_now);
        else
          v_earliest := greatest(v_cursor, app.stage_ready_at(v_step.job_id, v_step.seq, v_now));
          select w.start_at, w.end_at into v_start, v_end
          from app.machine_window(v_machine.id, v_machine.cal, v_tz, v_earliest, app.remaining_minutes(v_step, v_now)) w;
        end if;
        if v_start is distinct from v_step.planned_start or v_end is distinct from v_step.planned_end then
          update app.job_steps set planned_start = v_start, planned_end = v_end where id = v_step.id;
          v_changed := true;
        end if;
        v_cursor := v_end;
      end loop;
    end loop;

    for v_step in
      select s.* from app.job_steps s join app.jobs j on j.id = s.job_id
      where s.tenant_id = p_tenant and s.machine_id is null and app.on_floor(j.status, j.released_at)
        and s.status in ('pending', 'ready', 'in_progress', 'paused')
    loop
      v_earliest := case when v_step.status = 'in_progress' then v_now
                         else app.stage_ready_at(v_step.job_id, v_step.seq, v_now) end;
      if v_step.step_type = 'outsource' then
        select coalesce(max(vs.lead_time_days), 1) into v_lead from app.vendor_services vs
        where vs.process_id = v_step.process_id and (v_step.vendor_id is null or vs.vendor_id = v_step.vendor_id);
        v_start := coalesce(v_step.actual_start, v_earliest);
        -- Work at a vendor returns when the order says (received, else the promised date).
        select coalesce(o.received_at, o.expected_at) into v_end
        from app.outsource_orders o
        where o.job_step_id = v_step.id and o.status in ('sent', 'received')
        order by o.sent_at desc limit 1;
        v_end := coalesce(v_end, v_start + v_lead * interval '1 day');
      else
        select w.start_at, w.end_at into v_start, v_end
        from app.schedule_window(v_default, v_tz, v_earliest, app.remaining_minutes(v_step, v_now)) w;
        v_start := coalesce(v_step.actual_start, v_start);
      end if;
      if v_start is distinct from v_step.planned_start or v_end is distinct from v_step.planned_end then
        update app.job_steps set planned_start = v_start, planned_end = v_end where id = v_step.id;
        v_changed := true;
      end if;
    end loop;

    exit when not v_changed;
  end loop;

  update app.jobs j
  set planned_finish_at = x.finish,
      is_at_risk = j.due_date is not null and (x.finish at time zone v_tz)::date > j.due_date
  from (
    select job_id, max(case when status in ('done', 'skipped') then actual_end else planned_end end) as finish
    from app.job_steps where tenant_id = p_tenant group by job_id
  ) x
  where j.id = x.job_id and j.tenant_id = p_tenant and app.on_floor(j.status, j.released_at);

  perform set_config('app.in_command', 'off', true);
end
$$;
