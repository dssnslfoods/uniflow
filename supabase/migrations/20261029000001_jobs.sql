-- Production planning (M4, D-14…D-19): jobs matched to PO lines, routing steps,
-- submit-per-PO and approve-per-job. Planning edits go straight to the tables while
-- a job is in 'planning'; every status change goes through api.*.

create type app.job_status as enum (
  'planning', 'pending_approval', 'approved', 'in_production', 'on_hold',
  'ready_to_deliver', 'partially_delivered', 'completed', 'cancelled'
);
create type app.step_status as enum ('pending', 'ready', 'in_progress', 'paused', 'done', 'skipped', 'failed');
create type app.approval_action as enum ('submit', 'approve', 'reject', 'request_change', 'cancel');

create table app.jobs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default app.tenant_id() references app.tenants on delete cascade,
  job_no             text not null,
  sales_order_id     uuid not null,
  title              text not null check (length(trim(title)) > 0),
  qty                numeric(14,3) not null check (qty > 0),     -- pieces this job produces
  uom                text not null default 'ชิ้น',
  status             app.job_status not null default 'planning',
  priority           smallint not null default 3 check (priority between 1 and 5),
  due_date           date,
  proof_required     boolean not null default true,              -- G-03
  template_id        uuid,
  workflow_version   int not null default 0,
  planned_finish_at  timestamptz,
  is_at_risk         boolean not null default false,
  note               text,
  version            int not null default 1,                     -- optimistic lock for the board
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  unique (tenant_id, id),
  unique (tenant_id, job_no),
  foreign key (tenant_id, sales_order_id) references app.sales_orders (tenant_id, id),
  foreign key (tenant_id, template_id) references app.workflow_templates (tenant_id, id) on delete set null (template_id)
);
create index on app.jobs (tenant_id, status);
create index on app.jobs (tenant_id, due_date);
create index on app.jobs (tenant_id, sales_order_id);

-- D-14/D-19: M:N — a PO line may be split over jobs; one job may gang several lines.
create table app.job_order_items (
  tenant_id            uuid not null default app.tenant_id(),
  job_id               uuid not null,
  sales_order_item_id  uuid not null,
  qty                  numeric(14,3) not null check (qty > 0),
  primary key (job_id, sales_order_item_id),
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sales_order_item_id) references app.sales_order_items (tenant_id, id)
);
create index on app.job_order_items (tenant_id, sales_order_item_id);

create table app.job_steps (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default app.tenant_id(),
  job_id            uuid not null,
  seq               smallint not null check (seq > 0),          -- equal seq = parallel (D-07)
  process_id        uuid not null,
  step_type         app.step_type not null,                     -- copied from the process
  machine_id        uuid,
  vendor_id         uuid,
  assignee_id       uuid references auth.users,
  planned_qty       numeric(14,3) not null check (planned_qty > 0),  -- pieces entering the step
  n_up              smallint not null default 1 check (n_up > 0),    -- D-02
  passes            smallint not null default 1 check (passes > 0),
  est_minutes       numeric(10,2),
  status            app.step_status not null default 'pending',
  queue_position    int,
  planned_start     timestamptz,
  planned_end       timestamptz,
  actual_start      timestamptz,
  actual_end        timestamptz,
  good_qty          numeric(14,3) not null default 0,
  waste_qty         numeric(14,3) not null default 0,
  workflow_version  int not null default 0,
  note              text,
  unique (tenant_id, id),
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, process_id) references app.processes (tenant_id, id),
  foreign key (tenant_id, machine_id) references app.machines (tenant_id, id),
  foreign key (tenant_id, vendor_id) references app.vendors (tenant_id, id)
);
create index on app.job_steps (tenant_id, job_id, seq);
create index on app.job_steps (tenant_id, status);
create index on app.job_steps (tenant_id, machine_id, planned_start);

create table app.approvals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app.tenant_id() references app.tenants on delete cascade,
  entity_type    text not null default 'job',
  entity_id      uuid not null,
  version        int not null,
  action         app.approval_action not null,
  comment        text,
  self_approved  boolean not null default false,
  payload        jsonb,                 -- step snapshot on submit
  actor_id       uuid not null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index on app.approvals (tenant_id, entity_type, entity_id, created_at desc);

create table app.job_activity_logs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null default app.tenant_id() references app.tenants on delete cascade,
  job_id      uuid not null,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb,
  actor_id    uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id) on delete cascade
);
create index on app.job_activity_logs (tenant_id, job_id, created_at desc);

-- Step duration (BR-R05 with units fixed, G-10/G-11):
--   units   = ceil(qty / n_up) × passes
--   run     = units × (1 + waste%) + make-ready waste
--   minutes = setup + run ÷ (cap/hr × efficiency) × 60
create function app.estimate_step_minutes(
  p_qty numeric, p_n_up int, p_passes int,
  p_setup_min numeric, p_waste_pct numeric, p_makeready numeric,
  p_cap_per_hour numeric, p_efficiency_pct numeric
) returns numeric
language sql immutable
set search_path = ''
as $$
  select round(
    p_setup_min
    + (ceil(p_qty / greatest(p_n_up, 1)) * greatest(p_passes, 1) * (1 + p_waste_pct / 100) + p_makeready)
      / (p_cap_per_hour * p_efficiency_pct / 100) * 60,
    2)
  where p_cap_per_hour > 0 and p_efficiency_pct > 0
$$;

create function app.job_steps_derive() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_proc app.processes;
  v_mach app.machines;
begin
  select * into v_proc from app.processes where id = new.process_id;
  new.step_type := v_proc.step_type;

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
  elsif v_proc.step_type <> 'outsource' then
    new.est_minutes := null;   -- unknown until a machine is chosen
  end if;
  return new;
end
$$;
create trigger derive before insert or update of process_id, machine_id, planned_qty, n_up, passes on app.job_steps
  for each row execute function app.job_steps_derive();

-- Job number + guards ----------------------------------------------------------

create function app.jobs_defaults() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.job_no := app.next_doc_no('JOB');
  new.status := 'planning';
  return new;
end
$$;
create trigger defaults before insert on app.jobs for each row execute function app.jobs_defaults();

create function app.in_command() returns boolean
language sql stable
set search_path = ''
as $$
  select current_setting('app.in_command', true) = 'on'
$$;

-- Outside api.*: only 'planning' jobs are editable and status never changes.
create function app.jobs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if app.in_command() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from app.sales_orders where id = new.sales_order_id and status in ('confirmed', 'in_progress')) then
      perform app.fail('job.order_not_confirmed');
    end if;
    return new;
  end if;
  if old.status <> 'planning' then
    perform app.fail('job.not_planning');
  end if;
  if tg_op = 'UPDATE' and (new.status is distinct from old.status or new.job_no is distinct from old.job_no
                           or new.sales_order_id is distinct from old.sales_order_id) then
    perform app.fail('job.status_via_api');
  end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  return coalesce(new, old);
end
$$;
create trigger guard before insert or update or delete on app.jobs for each row execute function app.jobs_guard();

create function app.job_children_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.in_command()
     and exists (select 1 from app.jobs where id = coalesce(new.job_id, old.job_id) and status <> 'planning') then
    perform app.fail('job.not_planning');
  end if;
  return coalesce(new, old);
end
$$;
create trigger guard before insert or update or delete on app.job_order_items for each row execute function app.job_children_guard();
create trigger guard before insert or update or delete on app.job_steps for each row execute function app.job_children_guard();

-- A matched line must belong to the job's own PO.
create function app.job_order_items_check() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from app.jobs j join app.sales_order_items i on i.sales_order_id = j.sales_order_id
    where j.id = new.job_id and i.id = new.sales_order_item_id
  ) then
    perform app.fail('job.item_not_in_order');
  end if;
  return new;
end
$$;
create trigger same_order before insert or update on app.job_order_items
  for each row execute function app.job_order_items_check();

-- Coverage per PO line (BR-R11): matched qty across non-cancelled jobs.
create view app.sales_order_coverage_v with (security_invoker = true) as
select
  i.tenant_id,
  i.sales_order_id,
  i.id as sales_order_item_id,
  i.line_no,
  i.description,
  i.qty,
  coalesce(sum(m.qty) filter (where j.status <> 'cancelled'), 0) as matched_qty,
  i.qty - coalesce(sum(m.qty) filter (where j.status <> 'cancelled'), 0) as remaining_qty
from app.sales_order_items i
left join app.job_order_items m on m.sales_order_item_id = i.id
left join app.jobs j on j.id = m.job_id
group by i.id;
grant select on app.sales_order_coverage_v to authenticated;

-- Policies: supervisors plan (D-16); everyone reads; approvals/logs are written by api.* only.
select app.apply_tenant_policies('app.jobs', '{admin,manager,supervisor}');
select app.apply_tenant_policies('app.job_order_items', '{admin,manager,supervisor}', true);
select app.apply_tenant_policies('app.job_steps', '{admin,manager,supervisor}', true);
create policy tenant_delete_planning on app.jobs for delete to authenticated
  using (tenant_id = app.tenant_id() and app.has_role('admin', 'manager', 'supervisor') and status = 'planning');
grant delete on app.jobs to authenticated;

alter table app.approvals enable row level security;
alter table app.job_activity_logs enable row level security;
create policy tenant_read on app.approvals for select to authenticated using (tenant_id = app.tenant_id());
create policy tenant_read on app.job_activity_logs for select to authenticated using (tenant_id = app.tenant_id());
grant select on app.approvals, app.job_activity_logs to authenticated;

select app.add_standard_triggers('app.jobs');
select audit.enable('app.job_order_items');
select audit.enable('app.job_steps');

-- Commands -------------------------------------------------------------------

create function app.log_job(p_job uuid, p_action text, p_detail jsonb default '{}') returns void
language sql
set search_path = ''
as $$
  insert into app.job_activity_logs (tenant_id, job_id, action, detail)
  select tenant_id, id, p_action, p_detail from app.jobs where id = p_job
$$;

-- New job for a confirmed PO, optionally seeded from a template and matched lines.
-- p_items: [{"sales_order_item_id": "...", "qty": 1000}]
create function api.create_job(
  p_sales_order uuid, p_title text, p_template uuid default null, p_items jsonb default '[]'
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job   uuid;
  v_qty   numeric;
  v_due   date;
begin
  perform app.require_role('admin', 'manager', 'supervisor');

  select coalesce(sum((x ->> 'qty')::numeric), 0) into v_qty from jsonb_array_elements(p_items) x;
  select coalesce(min(coalesce(i.due_date, o.due_date)), max(o.due_date)) into v_due
  from app.sales_orders o
  left join app.sales_order_items i on i.sales_order_id = o.id
    and i.id in (select (x ->> 'sales_order_item_id')::uuid from jsonb_array_elements(p_items) x)
  where o.id = p_sales_order and o.tenant_id = app.tenant_id();

  insert into app.jobs (sales_order_id, title, qty, due_date, template_id)
  values (p_sales_order, trim(p_title), greatest(v_qty, 1), v_due, p_template)
  returning id into v_job;

  insert into app.job_order_items (job_id, sales_order_item_id, qty)
  select v_job, (x ->> 'sales_order_item_id')::uuid, (x ->> 'qty')::numeric
  from jsonb_array_elements(p_items) x
  where (x ->> 'qty')::numeric > 0;

  if p_template is not null then
    insert into app.job_steps (job_id, seq, process_id, step_type, machine_id, planned_qty)
    select v_job, s.seq, s.process_id, p.step_type,
           -- skip a default machine that is no longer available
           case when m.status = 'active' and m.deleted_at is null then s.default_machine_id end,
           greatest(v_qty, 1)
    from app.workflow_template_steps s
    join app.processes p on p.id = s.process_id
    left join app.machines m on m.id = s.default_machine_id
    where s.template_id = p_template and s.tenant_id = app.tenant_id()
    order by s.seq;
  end if;

  perform app.log_job(v_job, 'created', jsonb_build_object('template_id', p_template));
  return v_job;
end
$$;

-- Submit every planning job of a PO at once (D-15/D-18), only when coverage is exact (BR-R11).
create function api.submit_po_plan(p_sales_order uuid) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job   record;
  v_count int := 0;
begin
  perform app.require_role('admin', 'manager', 'supervisor');

  perform 1 from app.sales_orders
  where id = p_sales_order and tenant_id = app.tenant_id() and status in ('confirmed', 'in_progress')
  for update;
  if not found then
    perform app.fail('order.not_found');
  end if;

  if exists (select 1 from app.sales_order_coverage_v where sales_order_id = p_sales_order and remaining_qty <> 0) then
    perform app.fail('plan.coverage_incomplete');
  end if;

  if not exists (select 1 from app.jobs where sales_order_id = p_sales_order and status = 'planning') then
    perform app.fail('plan.nothing_to_submit');
  end if;

  if exists (
    select 1 from app.jobs j
    where j.sales_order_id = p_sales_order and j.status = 'planning'
      and not exists (select 1 from app.job_steps s where s.job_id = j.id)
  ) then
    perform app.fail('plan.job_without_steps');   -- BR-R01
  end if;

  perform set_config('app.in_command', 'on', true);
  for v_job in
    select * from app.jobs where sales_order_id = p_sales_order and status = 'planning' for update
  loop
    update app.jobs
    set status = 'pending_approval', workflow_version = workflow_version + 1, version = version + 1
    where id = v_job.id;
    update app.job_steps set workflow_version = v_job.workflow_version + 1 where job_id = v_job.id;

    insert into app.approvals (tenant_id, entity_id, version, action, payload)
    select v_job.tenant_id, v_job.id, v_job.workflow_version + 1, 'submit',
           jsonb_agg(to_jsonb(s) - 'tenant_id' order by s.seq)
    from app.job_steps s where s.job_id = v_job.id;

    perform app.log_job(v_job.id, 'submitted', jsonb_build_object('version', v_job.workflow_version + 1));
    v_count := v_count + 1;
  end loop;
  perform set_config('app.in_command', 'off', true);
  return v_count;
end
$$;

-- Approve all pending jobs of a PO, or only p_jobs. Segregation of duties (BR-R02, D-05).
create function api.approve_po_plan(p_sales_order uuid, p_jobs uuid[] default null) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job       record;
  v_submitter uuid;
  v_self_ok   boolean;
  v_count     int := 0;
begin
  perform app.require_role('manager');
  select coalesce((settings ->> 'allow_self_approval')::boolean, false) into v_self_ok
  from app.tenants where id = app.tenant_id();

  perform set_config('app.in_command', 'on', true);
  for v_job in
    select * from app.jobs
    where sales_order_id = p_sales_order and tenant_id = app.tenant_id() and status = 'pending_approval'
      and (p_jobs is null or id = any (p_jobs))
    for update
  loop
    select actor_id into v_submitter from app.approvals
    where entity_id = v_job.id and action = 'submit' order by version desc, created_at desc limit 1;

    if v_submitter = auth.uid() and not v_self_ok then
      perform app.fail('approval.self_approval');
    end if;

    update app.jobs set status = 'approved', version = version + 1 where id = v_job.id;
    insert into app.approvals (tenant_id, entity_id, version, action, self_approved)
    values (v_job.tenant_id, v_job.id, v_job.workflow_version, 'approve', v_submitter = auth.uid());
    perform app.log_job(v_job.id, 'approved', jsonb_build_object('self_approved', v_submitter = auth.uid()));
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    perform app.fail('approval.nothing_pending');
  end if;

  perform set_config('app.bypass_order_guard', 'on', true);
  update app.sales_orders set status = 'in_progress' where id = p_sales_order and status = 'confirmed';
  perform set_config('app.bypass_order_guard', 'off', true);
  perform set_config('app.in_command', 'off', true);
  return v_count;
end
$$;

-- Send jobs back to planning with a reason (reject or request change).
create function api.reject_jobs(p_jobs uuid[], p_reason text, p_request_change boolean default false) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job   record;
  v_count int := 0;
begin
  perform app.require_role('manager');
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform app.fail('approval.reason_required');
  end if;

  perform set_config('app.in_command', 'on', true);
  for v_job in
    select * from app.jobs
    where id = any (p_jobs) and tenant_id = app.tenant_id() and status = 'pending_approval'
    for update
  loop
    update app.jobs set status = 'planning', version = version + 1 where id = v_job.id;
    insert into app.approvals (tenant_id, entity_id, version, action, comment)
    values (v_job.tenant_id, v_job.id, v_job.workflow_version,
            (case when p_request_change then 'request_change' else 'reject' end)::app.approval_action, trim(p_reason));
    perform app.log_job(v_job.id, case when p_request_change then 'change_requested' else 'rejected' end,
                        jsonb_build_object('reason', trim(p_reason)));
    v_count := v_count + 1;
  end loop;
  perform set_config('app.in_command', 'off', true);

  if v_count = 0 then
    perform app.fail('approval.nothing_pending');
  end if;
  return v_count;
end
$$;

-- Cancel a job that has not started; its matched quantities free up for re-planning.
create function api.cancel_job(p_job uuid, p_reason text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform app.fail('approval.reason_required');
  end if;
  perform set_config('app.in_command', 'on', true);
  update app.jobs set status = 'cancelled', version = version + 1
  where id = p_job and tenant_id = app.tenant_id() and status in ('planning', 'pending_approval', 'approved');
  get diagnostics v_rows = row_count;
  perform set_config('app.in_command', 'off', true);
  if v_rows = 0 then
    perform app.fail('job.not_cancellable');
  end if;
  perform app.log_job(p_job, 'cancelled', jsonb_build_object('reason', trim(p_reason)));
end
$$;

-- A PO with live jobs can no longer be reopened or cancelled directly.
create or replace function api.reopen_sales_order(p_order uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  perform app.require_role('admin', 'manager');
  if exists (select 1 from app.jobs where sales_order_id = p_order and status <> 'cancelled') then
    perform app.fail('order.has_jobs');
  end if;
  perform set_config('app.bypass_order_guard', 'on', true);
  update app.sales_orders
  set status = 'draft', confirmed_at = null, confirmed_by = null
  where id = p_order and tenant_id = app.tenant_id() and status = 'confirmed';
  get diagnostics v_rows = row_count;
  perform set_config('app.bypass_order_guard', 'off', true);
  if v_rows = 0 then
    perform app.fail('order.not_reopenable');
  end if;
end
$$;

create or replace function api.cancel_sales_order(p_order uuid, p_reason text) returns void
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
  if exists (select 1 from app.jobs where sales_order_id = p_order and status <> 'cancelled') then
    perform app.fail('order.has_jobs');
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

revoke execute on function
  api.create_job(uuid, text, uuid, jsonb), api.submit_po_plan(uuid), api.approve_po_plan(uuid, uuid[]),
  api.reject_jobs(uuid[], text, boolean), api.cancel_job(uuid, text)
from public, anon;
grant execute on function
  api.create_job(uuid, text, uuid, jsonb), api.submit_po_plan(uuid), api.approve_po_plan(uuid, uuid[]),
  api.reject_jobs(uuid[], text, boolean), api.cancel_job(uuid, text)
to authenticated;
