-- Shop floor (FR-6.5/6.6, D-20): start / pause / complete steps with good & waste quantities,
-- machine downtime with reasons, and a scheduler that respects downtime and real run time.

-- Run time: run_minutes accumulates finished segments; resumed_at marks the running segment.
alter table app.job_steps
  add column run_minutes numeric(10,2) not null default 0,
  add column resumed_at  timestamptz;

create type app.step_action as enum ('start', 'pause', 'resume', 'complete');
create type app.downtime_reason as enum
  ('breakdown', 'planned_maintenance', 'no_operator', 'no_material', 'waiting_approval', 'changeover', 'other');

create table app.production_logs (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null default app.tenant_id() references app.tenants on delete cascade,
  job_step_id  uuid not null,
  action       app.step_action not null,
  good_qty     numeric(14,3),
  waste_qty    numeric(14,3),
  reason       text,
  machine_id   uuid,
  operator_id  uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, job_step_id) references app.job_steps (tenant_id, id) on delete cascade
);
create index on app.production_logs (tenant_id, job_step_id, created_at);
create index on app.production_logs (tenant_id, machine_id, created_at);

create table app.machine_downtimes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app.tenant_id() references app.tenants on delete cascade,
  machine_id    uuid not null,
  reason        app.downtime_reason not null,
  note          text,
  started_at    timestamptz not null default now(),
  expected_end  timestamptz,           -- planning estimate while the downtime is open
  ended_at      timestamptz,
  created_by    uuid default auth.uid(),
  ended_by      uuid,
  check (ended_at is null or ended_at >= started_at),
  foreign key (tenant_id, machine_id) references app.machines (tenant_id, id) on delete cascade
);
create unique index machine_downtimes_one_open on app.machine_downtimes (machine_id) where ended_at is null;
create index on app.machine_downtimes (tenant_id, machine_id, started_at);

alter table app.production_logs enable row level security;
alter table app.machine_downtimes enable row level security;
create policy tenant_read on app.production_logs for select to authenticated using (tenant_id = app.tenant_id());
create policy tenant_read on app.machine_downtimes for select to authenticated using (tenant_id = app.tenant_id());
grant select on app.production_logs, app.machine_downtimes to authenticated;
select audit.enable('app.machine_downtimes');

-- Scheduling with downtime ------------------------------------------------------

-- Like schedule_window, but a step never overlaps a machine downtime; it starts after it.
-- An open downtime blocks until expected_end (or one hour from now when no estimate was given).
create function app.machine_window(
  p_machine uuid, p_calendar uuid, p_tz text, p_from timestamptz, p_minutes numeric,
  out start_at timestamptz, out end_at timestamptz
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_from    timestamptz := p_from;
  v_blocked timestamptz;
begin
  for i in 1..20 loop
    select w.start_at, w.end_at into start_at, end_at from app.schedule_window(p_calendar, p_tz, v_from, p_minutes) w;
    select max(coalesce(d.ended_at, d.expected_end, now() + interval '1 hour')) into v_blocked
    from app.machine_downtimes d
    where d.machine_id = p_machine
      and d.started_at < greatest(end_at, start_at + interval '1 second')
      and coalesce(d.ended_at, d.expected_end, now() + interval '1 hour') > start_at;
    exit when v_blocked is null;
    v_from := v_blocked;
  end loop;
end
$$;

-- Minutes of work left on a step, from its estimate and the time it has actually run.
create function app.remaining_minutes(s app.job_steps, p_now timestamptz) returns numeric
language sql stable
set search_path = ''
as $$
  select greatest(
    coalesce(s.est_minutes, 0) - s.run_minutes
    - case when s.status = 'in_progress' and s.resumed_at is not null
           then extract(epoch from p_now - s.resumed_at) / 60 else 0 end,
    0)
$$;

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
        where s.machine_id = v_machine.id and j.status = 'in_production'
          and s.status in ('pending', 'ready', 'in_progress', 'paused')
        order by (s.status = 'in_progress') desc, (s.status = 'paused') desc, s.queue_position nulls last, s.id
      loop
        if v_step.status = 'in_progress' then
          -- Running now: it finishes after its remaining work; downtime does not move a running job.
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
      where s.tenant_id = p_tenant and s.machine_id is null and j.status = 'in_production'
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
  where j.id = x.job_id and j.tenant_id = p_tenant and j.status = 'in_production';

  perform set_config('app.in_command', 'off', true);
end
$$;

-- Commands -------------------------------------------------------------------

-- Load a step for a floor action: tenant, role, job released, row locked.
create function app.floor_step(p_step uuid) returns app.job_steps
language plpgsql
set search_path = ''
as $$
declare
  v_step app.job_steps;
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  select * into v_step from app.job_steps where id = p_step and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('step.not_found');
  end if;
  if not exists (select 1 from app.jobs where id = v_step.job_id and status = 'in_production') then
    perform app.fail('step.job_not_released');
  end if;
  return v_step;
end
$$;

create function api.start_step(p_step uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_step app.job_steps := app.floor_step(p_step);
  v_action app.step_action := case when v_step.status = 'paused' then 'resume' else 'start' end;
begin
  if v_step.status not in ('ready', 'paused') then
    perform app.fail('step.not_ready');
  end if;
  if v_step.machine_id is not null then
    if exists (select 1 from app.machines where id = v_step.machine_id and status <> 'active') then
      perform app.fail('step.machine_unavailable');
    end if;
    if exists (select 1 from app.machine_downtimes where machine_id = v_step.machine_id and ended_at is null) then
      perform app.fail('step.machine_down');
    end if;
    if exists (select 1 from app.job_steps where machine_id = v_step.machine_id and status = 'in_progress' and id <> p_step) then
      perform app.fail('step.machine_busy');
    end if;
  end if;

  perform set_config('app.in_command', 'on', true);
  update app.job_steps
  set status = 'in_progress', actual_start = coalesce(actual_start, now()), resumed_at = now(), version = version + 1
  where id = p_step;
  insert into app.production_logs (tenant_id, job_step_id, action, machine_id)
  values (v_step.tenant_id, p_step, v_action, v_step.machine_id);
  perform app.log_job(v_step.job_id, 'step_' || v_action, jsonb_build_object('step_id', p_step));
  perform app.reschedule(v_step.tenant_id);
end
$$;

create function api.pause_step(p_step uuid, p_reason text default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_step app.job_steps := app.floor_step(p_step);
begin
  if v_step.status <> 'in_progress' then
    perform app.fail('step.not_running');
  end if;
  perform set_config('app.in_command', 'on', true);
  update app.job_steps
  set status = 'paused',
      run_minutes = run_minutes + extract(epoch from now() - coalesce(resumed_at, now())) / 60,
      resumed_at = null, version = version + 1
  where id = p_step;
  insert into app.production_logs (tenant_id, job_step_id, action, reason, machine_id)
  values (v_step.tenant_id, p_step, 'pause', nullif(trim(p_reason), ''), v_step.machine_id);
  perform app.log_job(v_step.job_id, 'step_pause', jsonb_build_object('step_id', p_step, 'reason', p_reason));
  perform app.reschedule(v_step.tenant_id);
end
$$;

-- Finish a step with good / waste counts. Returns warnings: waste over allowance,
-- good quantity short of plan (G-07), and whether the whole job is now done.
create function api.complete_step(p_step uuid, p_good numeric, p_waste numeric default 0, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_step      app.job_steps := app.floor_step(p_step);
  v_allow_pct numeric;
  v_waste_pct numeric;
  v_job_done  boolean;
begin
  if v_step.status not in ('in_progress', 'paused') then
    perform app.fail('step.not_running');
  end if;
  if coalesce(p_good, -1) < 0 or coalesce(p_waste, 0) < 0 then
    perform app.fail('step.qty_invalid');
  end if;

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

  v_job_done := not exists (select 1 from app.job_steps where job_id = v_step.job_id and status not in ('done', 'skipped'));
  if v_job_done then
    update app.jobs set status = 'ready_to_deliver', version = version + 1 where id = v_step.job_id;
    perform app.log_job(v_step.job_id, 'production_finished');
  end if;
  perform app.reschedule(v_step.tenant_id);

  select default_running_waste_pct into v_allow_pct from app.processes where id = v_step.process_id;
  v_waste_pct := case when p_good + coalesce(p_waste, 0) > 0
                      then round(coalesce(p_waste, 0) / (p_good + coalesce(p_waste, 0)) * 100, 1) end;
  return jsonb_build_object(
    'job_done', v_job_done,
    'waste_pct', v_waste_pct,
    'waste_over', v_waste_pct is not null and v_waste_pct > coalesce(v_allow_pct, 0) and coalesce(p_waste, 0) > 0,
    'short_by', greatest(v_step.planned_qty - p_good, 0)
  );
end
$$;

-- Machine stops (FR-6.6). Expected minutes let the scheduler push the queue past the stop.
create function api.start_downtime(p_machine uuid, p_reason app.downtime_reason, p_expected_minutes int default null, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_tenant  uuid := app.tenant_id();
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  if not exists (select 1 from app.machines where id = p_machine and tenant_id = v_tenant) then
    perform app.fail('machine.not_found');
  end if;
  if exists (select 1 from app.machine_downtimes where machine_id = p_machine and ended_at is null) then
    perform app.fail('downtime.already_open');
  end if;

  -- A running step pauses with the machine.
  if exists (select 1 from app.job_steps where machine_id = p_machine and status = 'in_progress') then
    perform api.pause_step(
      (select id from app.job_steps where machine_id = p_machine and status = 'in_progress' limit 1),
      'downtime: ' || p_reason::text);
  end if;

  insert into app.machine_downtimes (machine_id, reason, note, expected_end)
  values (p_machine, p_reason, nullif(trim(p_note), ''),
          case when p_expected_minutes > 0 then now() + p_expected_minutes * interval '1 minute' end)
  returning id into v_id;

  perform app.reschedule(v_tenant);
  return v_id;
end
$$;

create function api.end_downtime(p_machine uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  update app.machine_downtimes set ended_at = now(), ended_by = auth.uid()
  where machine_id = p_machine and tenant_id = app.tenant_id() and ended_at is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    perform app.fail('downtime.not_open');
  end if;
  perform app.reschedule(app.tenant_id());
end
$$;

revoke execute on function
  api.start_step(uuid), api.pause_step(uuid, text), api.complete_step(uuid, numeric, numeric, text),
  api.start_downtime(uuid, app.downtime_reason, int, text), api.end_downtime(uuid)
from public, anon;
grant execute on function
  api.start_step(uuid), api.pause_step(uuid, text), api.complete_step(uuid, numeric, numeric, text),
  api.start_downtime(uuid, app.downtime_reason, int, text), api.end_downtime(uuid)
to authenticated;
