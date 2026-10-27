-- Scheduling (M6, design §6.2/§6.3/§8.1): release approved jobs, step readiness,
-- forward finite-capacity scheduling over shift calendars, and moving cards on the board.

alter table app.jobs add column released_at timestamptz;
alter table app.job_steps add column version int not null default 1;   -- optimistic lock for drag & drop
create index on app.job_steps (tenant_id, machine_id, queue_position) where machine_id is not null;

-- Scheduler writes are bookkeeping, not user changes: keep them out of the audit log.
create or replace function audit.capture() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row  jsonb := coalesce(v_new, v_old);
  v_diff jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value))
      into v_diff
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'updated_by', 'version',
                        'planned_start', 'planned_end', 'planned_finish_at', 'is_at_risk')
      and (v_old -> n.key) is distinct from n.value;
    if v_diff is null then
      return new;
    end if;
  else
    v_diff := v_row;
  end if;

  insert into audit.logs (tenant_id, table_name, record_id, operation, actor_id, diff)
  values (
    coalesce((v_row ->> 'tenant_id')::uuid, case when tg_table_name = 'tenants' then (v_row ->> 'id')::uuid end),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    tg_op,
    auth.uid(),
    v_diff
  );
  return coalesce(new, old);
end
$$;

-- Calendar helpers ---------------------------------------------------------------

create function app.tenant_tz(p_tenant uuid) returns text
language sql stable
set search_path = ''
as $$
  select coalesce((select settings ->> 'timezone' from app.tenants where id = p_tenant), 'Asia/Bangkok')
$$;

create function app.default_calendar(p_tenant uuid) returns uuid
language sql stable
set search_path = ''
as $$
  select id from app.calendars where tenant_id = p_tenant and is_default
$$;

create function app.is_holiday(p_calendar uuid, p_day date) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from app.holidays h join app.calendars c on c.tenant_id = h.tenant_id
    where c.id = p_calendar and h.day = p_day and (h.calendar_id is null or h.calendar_id = p_calendar)
  )
$$;

-- Working minutes a calendar offers on one local day.
create function app.available_minutes(p_calendar uuid, p_day date) returns numeric
language sql stable
set search_path = ''
as $$
  select case when app.is_holiday(p_calendar, p_day) then 0
         else coalesce(sum(extract(epoch from s.end_time - s.start_time) / 60), 0) end
  from app.calendar_shifts s
  where s.calendar_id = p_calendar and s.weekday = extract(dow from p_day)
$$;

-- Consume p_minutes of working time starting no earlier than p_from (G-05):
-- skips non-shift hours, breaks between shifts, days without shifts and holidays.
create function app.schedule_window(
  p_calendar uuid, p_tz text, p_from timestamptz, p_minutes numeric,
  out start_at timestamptz, out end_at timestamptz
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_from      timestamp := p_from at time zone p_tz;
  v_day       date := (p_from at time zone p_tz)::date;
  v_left      numeric := greatest(coalesce(p_minutes, 0), 0);
  v_started   timestamp;
  v_shift     record;
  v_seg_start timestamp;
  v_seg_end   timestamp;
  v_avail     numeric;
begin
  for i in 0..400 loop
    if not app.is_holiday(p_calendar, v_day) then
      for v_shift in
        select s.start_time, s.end_time from app.calendar_shifts s
        where s.calendar_id = p_calendar and s.weekday = extract(dow from v_day)
        order by s.start_time
      loop
        v_seg_start := greatest(v_day + v_shift.start_time, v_from);
        v_seg_end := v_day + v_shift.end_time;
        continue when v_seg_end <= v_seg_start;
        v_started := coalesce(v_started, v_seg_start);
        v_avail := extract(epoch from v_seg_end - v_seg_start) / 60;
        if v_left <= v_avail then
          start_at := v_started at time zone p_tz;
          end_at := (v_seg_start + v_left * interval '1 minute') at time zone p_tz;
          return;
        end if;
        v_left := v_left - v_avail;
      end loop;
    end if;
    v_day := v_day + 1;
  end loop;
  perform app.fail('schedule.no_working_time');
end
$$;

-- Earliest moment a step may start: every step in an earlier stage of the job has finished (D-07).
create function app.stage_ready_at(p_job uuid, p_seq int, p_now timestamptz) returns timestamptz
language sql stable
set search_path = ''
as $$
  select greatest(p_now, max(
    case when s.status in ('done', 'skipped') then s.actual_end else s.planned_end end))
  from app.job_steps s
  where s.job_id = p_job and s.seq < p_seq
$$;

-- Readiness (design §6.2): pending → ready once all earlier stages are done or skipped.
create function app.refresh_readiness(p_job uuid) returns void
language sql
set search_path = ''
as $$
  update app.job_steps s set status = 'ready'
  where s.job_id = p_job and s.status = 'pending'
    and exists (select 1 from app.jobs j where j.id = p_job and j.status = 'in_production')
    and not exists (
      select 1 from app.job_steps p
      where p.job_id = s.job_id and p.seq < s.seq and p.status not in ('done', 'skipped')
    )
$$;

-- Forward finite-capacity scheduling for a whole tenant (design §6.3).
-- Each machine runs its queue in order from now; a step also waits for its job's earlier stage.
-- Cross-machine dependencies converge over a few passes.
create function app.reschedule(p_tenant uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tz       text := app.tenant_tz(p_tenant);
  v_default  uuid := app.default_calendar(p_tenant);
  v_now      timestamptz := now();
  v_changed  boolean;
  v_machine  record;
  v_step     record;
  v_cursor   timestamptz;
  v_earliest timestamptz;
  v_minutes  numeric;
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
        order by (s.status = 'in_progress') desc, s.queue_position nulls last, s.id
      loop
        v_minutes := coalesce(v_step.est_minutes, 0);
        if v_step.status = 'in_progress' and v_step.actual_start is not null then
          v_minutes := greatest(v_minutes - extract(epoch from v_now - v_step.actual_start) / 60, 0);
          v_earliest := v_now;
        else
          v_earliest := greatest(v_cursor, app.stage_ready_at(v_step.job_id, v_step.seq, v_now));
        end if;
        select w.start_at, w.end_at into v_start, v_end
        from app.schedule_window(v_machine.cal, v_tz, v_earliest, v_minutes) w;
        if v_step.status = 'in_progress' then
          v_start := coalesce(v_step.actual_start, v_start);
        end if;
        if v_start is distinct from v_step.planned_start or v_end is distinct from v_step.planned_end then
          update app.job_steps set planned_start = v_start, planned_end = v_end where id = v_step.id;
          v_changed := true;
        end if;
        v_cursor := v_end;
      end loop;
    end loop;

    -- Steps off the machines: outsource uses vendor lead time (G-19), manual steps use the default calendar.
    for v_step in
      select s.* from app.job_steps s join app.jobs j on j.id = s.job_id
      where s.tenant_id = p_tenant and s.machine_id is null and j.status = 'in_production'
        and s.status in ('pending', 'ready', 'in_progress', 'paused')
    loop
      v_earliest := app.stage_ready_at(v_step.job_id, v_step.seq, v_now);
      if v_step.step_type = 'outsource' then
        select coalesce(max(vs.lead_time_days), 1) into v_lead from app.vendor_services vs
        where vs.process_id = v_step.process_id and (v_step.vendor_id is null or vs.vendor_id = v_step.vendor_id);
        v_start := v_earliest;
        v_end := v_earliest + v_lead * interval '1 day';
      else
        select w.start_at, w.end_at into v_start, v_end
        from app.schedule_window(v_default, v_tz, v_earliest, coalesce(v_step.est_minutes, 0)) w;
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
    select job_id, max(coalesce(actual_end, planned_end)) as finish
    from app.job_steps where tenant_id = p_tenant group by job_id
  ) x
  where j.id = x.job_id and j.tenant_id = p_tenant and j.status = 'in_production';

  perform set_config('app.in_command', 'off', true);
end
$$;

-- Commands -------------------------------------------------------------------

-- Release approved jobs to the floor (G-01). Stock/proof gates attach here once
-- Inventory and Design ship (D-01); with the features off there is nothing to check.
create function app.release_one(p_job uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  update app.jobs set status = 'in_production', released_at = now(), version = version + 1
  where id = p_job;

  -- Append machine steps to the end of their machine queues, in stage order.
  update app.job_steps s
  set queue_position = q.pos
  from (
    select s2.id,
           coalesce((select max(x.queue_position) from app.job_steps x
                     where x.machine_id = s2.machine_id and x.job_id <> p_job), 0)
           + row_number() over (partition by s2.machine_id order by s2.seq, s2.id) as pos
    from app.job_steps s2
    where s2.job_id = p_job and s2.machine_id is not null
  ) q
  where s.id = q.id;

  perform app.refresh_readiness(p_job);
  perform app.log_job(p_job, 'released');
end
$$;

create function api.release_jobs(p_jobs uuid[]) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job   uuid;
  v_count int := 0;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  perform set_config('app.in_command', 'on', true);
  for v_job in
    select id from app.jobs
    where id = any (p_jobs) and tenant_id = app.tenant_id() and status = 'approved'
    order by due_date nulls last, created_at
    for update
  loop
    perform app.release_one(v_job);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    perform app.fail('release.nothing_approved');
  end if;
  perform app.reschedule(app.tenant_id());
  return v_count;
end
$$;

-- Drag & drop (FR-6.2/6.3): put a step on a machine (or back to "unscheduled" with null),
-- before p_before (null = end of queue). Returns warnings for the UI.
create function api.move_step(p_step uuid, p_machine uuid, p_before uuid, p_version int) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_step     app.job_steps;
  v_job      app.jobs;
  v_tenant   uuid := app.tenant_id();
  v_ids      uuid[];
  v_day      date;
  v_cal      uuid;
  v_load     numeric;
  v_avail    numeric;
begin
  perform app.require_role('admin', 'manager', 'supervisor');

  select * into v_step from app.job_steps where id = p_step and tenant_id = v_tenant for update;
  if not found then
    perform app.fail('step.not_found');
  end if;
  if v_step.version <> p_version then
    perform app.fail('step.conflict');
  end if;
  if v_step.status not in ('pending', 'ready') then
    perform app.fail('step.not_movable');
  end if;
  select * into v_job from app.jobs where id = v_step.job_id;
  if v_job.status not in ('approved', 'in_production') then
    perform app.fail('step.job_not_released');
  end if;

  if p_machine is not null then
    -- Serialise moves per machine so two supervisors cannot interleave a queue.
    perform 1 from app.machines where id = p_machine and tenant_id = v_tenant for update;
  end if;

  perform set_config('app.in_command', 'on', true);
  -- job_steps_derive checks capability and availability (BR-R08) and re-estimates time.
  update app.job_steps set machine_id = p_machine, version = version + 1 where id = p_step;

  if p_machine is null then
    update app.job_steps set queue_position = null where id = p_step;
  else
    select array_agg(id order by queue_position nulls last, id) into v_ids
    from app.job_steps
    where machine_id = p_machine and id <> p_step and status in ('pending', 'ready', 'in_progress', 'paused');

    v_ids := coalesce(v_ids, '{}');
    if p_before is not null and p_before = any (v_ids) then
      v_ids := v_ids[1:array_position(v_ids, p_before) - 1] || p_step || v_ids[array_position(v_ids, p_before):];
    else
      v_ids := v_ids || p_step;
    end if;

    update app.job_steps s set queue_position = x.pos
    from unnest(v_ids) with ordinality as x(id, pos)
    where s.id = x.id and s.queue_position is distinct from x.pos;
  end if;

  perform app.log_job(v_step.job_id, 'step_moved', jsonb_build_object(
    'step_id', p_step, 'from_machine', v_step.machine_id, 'to_machine', p_machine));
  perform app.reschedule(v_tenant);

  -- Warnings (FR-6.3): overloaded day on the target machine, jobs now expected late.
  select * into v_step from app.job_steps where id = p_step;
  if p_machine is not null and v_step.planned_start is not null then
    v_day := (v_step.planned_start at time zone app.tenant_tz(v_tenant))::date;
    select coalesce(calendar_id, app.default_calendar(v_tenant)) into v_cal from app.machines where id = p_machine;
    v_avail := app.available_minutes(v_cal, v_day);
    select coalesce(sum(est_minutes), 0) into v_load from app.job_steps
    where machine_id = p_machine and status in ('pending', 'ready', 'in_progress', 'paused')
      and (planned_start at time zone app.tenant_tz(v_tenant))::date = v_day;
  end if;

  return jsonb_build_object(
    'version', v_step.version,
    'planned_start', v_step.planned_start,
    'planned_end', v_step.planned_end,
    'day', v_day,
    'load_pct', case when v_avail > 0 then round(v_load / v_avail * 100) end,
    'late_jobs', coalesce((
      select jsonb_agg(job_no order by job_no) from app.jobs
      where tenant_id = v_tenant and status = 'in_production' and is_at_risk), '[]'::jsonb)
  );
end
$$;

-- Recompute after time has passed (the board calls this on open).
create function api.reschedule() returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'executive', 'staff');
  perform app.reschedule(app.tenant_id());
end
$$;

-- Load % per machine and day (BR-R06). Planned minutes are counted on the day a step starts —
-- a fair approximation for steps shorter than a shift; long steps over-count their first day.
create function api.machine_load(p_from date, p_days int default 7)
returns table (machine_id uuid, day date, available_min numeric, planned_min numeric)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_tz     text := app.tenant_tz(app.tenant_id());
begin
  if v_tenant is null then
    perform app.fail('auth.no_tenant');
  end if;
  return query
  select m.id, d::date,
         app.available_minutes(coalesce(m.calendar_id, app.default_calendar(v_tenant)), d::date),
         coalesce((
           select sum(s.est_minutes) from app.job_steps s join app.jobs j on j.id = s.job_id
           where s.machine_id = m.id and j.status = 'in_production'
             and s.status in ('pending', 'ready', 'in_progress', 'paused')
             and (s.planned_start at time zone v_tz)::date = d::date), 0)
  from app.machines m
  cross join generate_series(p_from::timestamp, (p_from + (greatest(p_days, 1) - 1))::timestamp, interval '1 day') d
  where m.tenant_id = v_tenant and m.deleted_at is null;
end
$$;

revoke execute on function
  api.release_jobs(uuid[]), api.move_step(uuid, uuid, uuid, int), api.reschedule(), api.machine_load(date, int)
from public, anon;
grant execute on function
  api.release_jobs(uuid[]), api.move_step(uuid, uuid, uuid, int), api.reschedule(), api.machine_load(date, int)
to authenticated;
