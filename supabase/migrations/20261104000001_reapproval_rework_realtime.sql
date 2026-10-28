-- Sprint 7: edit a flow after approval → re-approval (FR-4.7, BR-R04, D-04), rework steps (G-04),
-- alternative machine suggestions (SRS §7.4) and realtime board broadcasts (design §6.8).

alter table app.job_steps
  add column is_rework boolean not null default false,
  add column rework_of_step_id uuid,
  add column rework_reason text;

-- A released job stays "on the floor" while its new flow waits for approval or is on hold.
create function app.on_floor(p_status app.job_status, p_released_at timestamptz) returns boolean
language sql immutable
set search_path = ''
as $$
  select p_released_at is not null and p_status in ('in_production', 'pending_approval', 'on_hold')
$$;

-- Floor actions: during re-approval or hold, steps already running may pause/resume/finish (D-04);
-- nothing new starts until the job is back in production.
create or replace function app.floor_step(p_step uuid) returns app.job_steps
language plpgsql
set search_path = ''
as $$
declare
  v_step app.job_steps;
  v_job  app.jobs;
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  select * into v_step from app.job_steps where id = p_step and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('step.not_found');
  end if;
  select * into v_job from app.jobs where id = v_step.job_id;
  if v_job.status <> 'in_production' then
    if app.on_floor(v_job.status, v_job.released_at) and v_step.status in ('in_progress', 'paused') then
      null;   -- running work continues
    elsif app.on_floor(v_job.status, v_job.released_at) then
      perform app.fail('step.job_reapproval');
    else
      perform app.fail('step.job_not_released');
    end if;
  end if;
  if v_step.machine_id is not null
     and not app.has_role('admin', 'manager', 'supervisor')
     and exists (select 1 from app.machine_operators where machine_id = v_step.machine_id)
     and not exists (
       select 1 from app.machine_operators o join app.memberships m on m.id = o.membership_id
       where o.machine_id = v_step.machine_id and m.user_id = auth.uid() and m.is_active
     ) then
    perform app.fail('step.not_your_machine');
  end if;
  return v_step;
end
$$;

-- Scheduler: same algorithm as before, over every job on the floor.
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
        v_end := v_start + v_lead * interval '1 day';
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

-- Put machine steps without a queue position at the end of their machine's queue.
create function app.enqueue_new_steps(p_job uuid) returns void
language sql
set search_path = ''
as $$
  update app.job_steps s
  set queue_position = q.pos
  from (
    select s2.id,
           coalesce((select max(x.queue_position) from app.job_steps x
                     where x.machine_id = s2.machine_id and x.queue_position is not null), 0)
           + row_number() over (partition by s2.machine_id order by s2.seq, s2.id) as pos
    from app.job_steps s2
    where s2.job_id = p_job and s2.machine_id is not null and s2.queue_position is null
      and s2.status in ('pending', 'ready')
  ) q
  where s.id = q.id
$$;

-- Edit the flow of an approved / released / on-hold job (FR-4.7). p_steps is the whole new flow:
-- [{"id"?, "seq", "process_id", "machine_id"?, "planned_qty", "n_up"?, "passes"?, "note"?}]
-- Steps that started or finished are locked and must appear unchanged (BR-R04).
create function api.edit_workflow(p_job uuid, p_steps jsonb, p_reason text default null) returns void
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
           or v_old.planned_qty <> (v_item ->> 'planned_qty')::numeric then
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
          status = 'pending',
          queue_position = case when machine_id is distinct from (v_item ->> 'machine_id')::uuid then null else queue_position end,
          version = version + 1
        where id = v_old.id;
      end if;
    else
      insert into app.job_steps (tenant_id, job_id, seq, process_id, step_type, machine_id, planned_qty, n_up, passes, note)
      select v_job.tenant_id, p_job, (v_item ->> 'seq')::int, p.id, p.step_type, (v_item ->> 'machine_id')::uuid,
             (v_item ->> 'planned_qty')::numeric, coalesce((v_item ->> 'n_up')::int, 1),
             coalesce((v_item ->> 'passes')::int, 1), v_item ->> 'note'
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

-- Approval: a job that was already released goes straight back to production.
create or replace function api.approve_po_plan(p_sales_order uuid, p_jobs uuid[] default null) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job       record;
  v_submitter uuid;
  v_self_ok   boolean;
  v_count     int := 0;
  v_released  boolean := false;
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

    update app.jobs
    set status = case when released_at is not null then 'in_production' else 'approved' end::app.job_status,
        version = version + 1
    where id = v_job.id;
    insert into app.approvals (tenant_id, entity_id, version, action, self_approved)
    values (v_job.tenant_id, v_job.id, v_job.workflow_version, 'approve', v_submitter = auth.uid());
    perform app.log_job(v_job.id, 'approved', jsonb_build_object('self_approved', v_submitter = auth.uid()));

    if v_job.released_at is not null then
      perform app.enqueue_new_steps(v_job.id);
      perform app.refresh_readiness(v_job.id);
      v_released := true;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    perform app.fail('approval.nothing_pending');
  end if;

  perform set_config('app.bypass_order_guard', 'on', true);
  update app.sales_orders set status = 'in_progress' where id = p_sales_order and status = 'confirmed';
  perform set_config('app.bypass_order_guard', 'off', true);
  if v_released then
    perform app.reschedule(app.tenant_id());
  end if;
  perform set_config('app.in_command', 'off', true);
  return v_count;
end
$$;

-- Rejection: a released job goes on hold (its floor work cannot return to planning).
create or replace function api.reject_jobs(p_jobs uuid[], p_reason text, p_request_change boolean default false) returns int
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
    update app.jobs
    set status = case when released_at is not null then 'on_hold' else 'planning' end::app.job_status,
        version = version + 1
    where id = v_job.id;
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

-- Rework (G-04): redo part of a finished step without re-approval. The new step slots in right
-- after the source step; later stages wait for it.
create function api.add_rework_step(p_step uuid, p_qty numeric, p_reason text, p_machine uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_src     app.job_steps;
  v_machine uuid;
  v_id      uuid;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  select * into v_src from app.job_steps where id = p_step and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('step.not_found');
  end if;
  if v_src.status not in ('done', 'failed') then
    perform app.fail('rework.source_not_finished');
  end if;
  if not exists (select 1 from app.jobs where id = v_src.job_id and status in ('in_production', 'ready_to_deliver')) then
    perform app.fail('step.job_not_released');
  end if;
  if coalesce(p_qty, 0) <= 0 then
    perform app.fail('step.qty_invalid');
  end if;
  if coalesce(length(trim(p_reason)), 0) = 0 then
    perform app.fail('approval.reason_required');
  end if;

  v_machine := coalesce(p_machine,
    (select id from app.machines where id = v_src.machine_id and status = 'active' and deleted_at is null));

  perform set_config('app.in_command', 'on', true);
  -- A finished job reopens for the rework.
  update app.jobs set status = 'in_production', version = version + 1
  where id = v_src.job_id and status = 'ready_to_deliver';

  update app.job_steps set seq = seq + 1 where job_id = v_src.job_id and seq > v_src.seq;
  update app.job_steps set status = 'pending' where job_id = v_src.job_id and seq > v_src.seq + 1 and status = 'ready';

  insert into app.job_steps (tenant_id, job_id, seq, process_id, step_type, machine_id, planned_qty, n_up, passes,
                             is_rework, rework_of_step_id, rework_reason)
  values (v_src.tenant_id, v_src.job_id, v_src.seq + 1, v_src.process_id, v_src.step_type, v_machine, p_qty,
          v_src.n_up, v_src.passes, true, v_src.id, trim(p_reason))
  returning id into v_id;

  perform app.enqueue_new_steps(v_src.job_id);
  perform app.refresh_readiness(v_src.job_id);
  perform app.log_job(v_src.job_id, 'rework_added', jsonb_build_object('step_id', v_id, 'qty', p_qty, 'reason', trim(p_reason)));
  perform app.reschedule(v_src.tenant_id);
  return v_id;
end
$$;

-- Alternative machines for a step (SRS §7.4): every capable, active machine with the time the
-- step would take there and when it could finish behind that machine's current queue.
create function api.suggest_machines(p_step uuid)
returns table (machine_id uuid, name text, est_minutes numeric, start_at timestamptz, end_at timestamptz, is_current boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_step    app.job_steps;
  v_proc    app.processes;
  v_tz      text := app.tenant_tz(app.tenant_id());
  v_default uuid := app.default_calendar(app.tenant_id());
  v_m       record;
  v_est     numeric;
  v_from    timestamptz;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  select * into v_step from app.job_steps where id = p_step and tenant_id = app.tenant_id();
  if not found then
    perform app.fail('step.not_found');
  end if;
  select * into v_proc from app.processes where id = v_step.process_id;

  for v_m in
    select m.* from app.machines m
    join app.machine_processes mp on mp.machine_id = m.id and mp.process_id = v_step.process_id
    where m.tenant_id = v_step.tenant_id and m.status = 'active' and m.deleted_at is null
  loop
    v_est := app.estimate_step_minutes(v_step.planned_qty, v_step.n_up, v_step.passes,
      v_m.setup_min, v_proc.default_running_waste_pct, v_m.makeready_waste_units, v_m.max_cap_per_hour, v_m.efficiency_pct);
    select greatest(now(), app.stage_ready_at(v_step.job_id, v_step.seq, now()),
                    coalesce(max(s.planned_end), now()))
      into v_from
    from app.job_steps s
    where s.machine_id = v_m.id and s.id <> p_step and s.status in ('pending', 'ready', 'in_progress', 'paused');

    machine_id := v_m.id;
    name := v_m.name;
    est_minutes := v_est;
    is_current := v_m.id = v_step.machine_id;
    select w.start_at, w.end_at into start_at, end_at
    from app.machine_window(v_m.id, coalesce(v_m.calendar_id, v_default), v_tz, v_from, v_est) w;
    return next;
  end loop;
end
$$;

revoke execute on function
  api.edit_workflow(uuid, jsonb, text), api.add_rework_step(uuid, numeric, text, uuid), api.suggest_machines(uuid)
from public, anon;
grant execute on function
  api.edit_workflow(uuid, jsonb, text), api.add_rework_step(uuid, numeric, text, uuid), api.suggest_machines(uuid)
to authenticated;

-- Realtime (design §6.8): one "changed" broadcast per transaction on a private per-tenant
-- topic; clients refetch. Installed only where Supabase Realtime exists.
create function app.broadcast_board() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
begin
  if v_tenant is null or current_setting('app.board_broadcast_sent', true) = 'on' then
    return null;
  end if;
  perform set_config('app.board_broadcast_sent', 'on', true);
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'tenant:' || v_tenant || ':board', true);
  exception when others then
    null;   -- a missed broadcast must never fail the write; clients also poll
  end;
  return null;
end
$$;

do $$
begin
  if to_regproc('realtime.send') is null then
    return;
  end if;
  create trigger broadcast after insert or update or delete on app.job_steps for each statement execute function app.broadcast_board();
  create trigger broadcast after insert or update or delete on app.jobs for each statement execute function app.broadcast_board();
  create trigger broadcast after insert or update or delete on app.machine_downtimes for each statement execute function app.broadcast_board();
  create trigger broadcast after update on app.machines for each statement execute function app.broadcast_board();

  -- Members may listen only to their own tenant's board topic.
  create policy uniflow_board_read on realtime.messages for select to authenticated
    using (realtime.messages.extension = 'broadcast' and realtime.topic() = 'tenant:' || app.tenant_id() || ':board');
end
$$;
