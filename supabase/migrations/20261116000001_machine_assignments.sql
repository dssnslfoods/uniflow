-- Who looks after which machine, over time (board drag-and-drop of staff onto machines).
--
-- app.machine_operators stays the "who is on this machine now" table: the board, the settings
-- page and floor access (app.floor_step) all read and write it. Every insert/delete there is
-- mirrored into app.machine_assignments, a dated history used by the staffing report:
-- hours per person/machine, utilisation, and overtime (machine running outside its shifts).

create table app.machine_assignments (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references app.tenants on delete cascade,
  machine_id     uuid not null,
  profile_id     uuid not null references app.profiles (id) on delete cascade,
  membership_id  uuid,                       -- null once the member left the shop; history stays
  valid_from     timestamptz not null default now(),
  valid_to       timestamptz,                -- null = still assigned
  assigned_by    uuid,
  ended_by       uuid,
  check (valid_to is null or valid_to >= valid_from),
  foreign key (tenant_id, machine_id) references app.machines (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references app.memberships (tenant_id, id) on delete set null (membership_id)
);
create unique index machine_assignments_one_open on app.machine_assignments (machine_id, profile_id) where valid_to is null;
create index on app.machine_assignments (tenant_id, machine_id, valid_from);
create index on app.machine_assignments (tenant_id, profile_id, valid_from);

-- Read: managers and up see everyone's history; written only by the trigger below.
alter table app.machine_assignments enable row level security;
create policy tenant_read on app.machine_assignments for select to authenticated
  using (tenant_id = app.tenant_id() and app.has_role('admin', 'executive', 'manager', 'supervisor'));
grant select on app.machine_assignments to authenticated;

create function app.machine_operators_history() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if tg_op = 'INSERT' then
    select user_id into v_user from app.memberships where id = new.membership_id;
    insert into app.machine_assignments (tenant_id, machine_id, profile_id, membership_id, assigned_by)
    values (new.tenant_id, new.machine_id, v_user, new.membership_id, auth.uid())
    on conflict (machine_id, profile_id) where valid_to is null do nothing;
    return new;
  end if;
  -- DELETE (also when the membership or machine is deleted): close the open period.
  select user_id into v_user from app.memberships where id = old.membership_id;
  update app.machine_assignments
  set valid_to = now(), ended_by = auth.uid()
  where machine_id = old.machine_id and valid_to is null
    and (membership_id = old.membership_id or profile_id = v_user);
  return old;
end
$$;

create trigger history after insert or delete on app.machine_operators
for each row execute function app.machine_operators_history();

-- A member who is deactivated or removed no longer looks after any machine. Removal runs
-- before the delete so the history is closed while the membership still exists.
create function app.memberships_drop_operators() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from app.machine_operators where membership_id = old.id;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger drop_operators after update of is_active on app.memberships
for each row when (old.is_active and not new.is_active)
execute function app.memberships_drop_operators();
create trigger drop_operators_on_delete before delete on app.memberships
for each row execute function app.memberships_drop_operators();

-- Existing assignments start their history now (their real start is unknown).
insert into app.machine_assignments (tenant_id, machine_id, profile_id, membership_id)
select o.tenant_id, o.machine_id, m.user_id, o.membership_id
from app.machine_operators o join app.memberships m on m.id = o.membership_id;

-- Working minutes of a calendar that fall inside [p_from, p_to) (holidays excluded).
create function app.shift_minutes_between(p_calendar uuid, p_tz text, p_from timestamptz, p_to timestamptz)
returns numeric
language sql stable
set search_path = ''
as $$
  select coalesce(sum(greatest(0, extract(epoch from
           least(p_to, (d::date + s.end_time) at time zone p_tz)
           - greatest(p_from, (d::date + s.start_time) at time zone p_tz)) / 60)), 0)
  from generate_series((p_from at time zone p_tz)::date::timestamp, (p_to at time zone p_tz)::date::timestamp, interval '1 day') d
  join app.calendar_shifts s on s.calendar_id = p_calendar and s.weekday = extract(dow from d)
  where p_to > p_from and not app.is_holiday(p_calendar, d::date)
$$;

-- Staffing report (exec decisions: add people? is the overtime justified? are people used well?).
--   run    = machine running time from shop-floor logs (start/resume → pause/complete).
--   ot     = the part of run time outside the machine's shifts or on holidays.
--   A person's share of run/ot is the machine's time while they were assigned, split evenly
--   between everyone assigned at that moment. Run time with nobody assigned is "unstaffed".
--   shift  = a person's working minutes: per day, the longest shift among the machines they
--            were assigned to that day (two machines on one calendar do not double the hours).
create function api.staffing_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_tz     text;
  v_to     date;
  v_from_ts timestamptz;
  v_to_ts   timestamptz;
  v_result jsonb;
begin
  perform app.require_role('admin', 'executive', 'manager', 'supervisor');
  v_tz := app.tenant_tz(v_tenant);
  v_to := least(p_to, (now() at time zone v_tz)::date);
  if p_from is null or v_to is null or p_from > v_to then
    perform app.fail('report.bad_period');
  end if;
  if v_to - p_from > 366 then
    perform app.fail('report.period_too_long');
  end if;
  v_from_ts := p_from::timestamp at time zone v_tz;
  v_to_ts := least((v_to + 1)::timestamp at time zone v_tz, now());

  with mach as (
    select m.id, m.name, m.sort_order, coalesce(m.calendar_id, app.default_calendar(v_tenant)) as cal
    from app.machines m where m.tenant_id = v_tenant
  ),
  logs as (
    select l.action, l.created_at, coalesce(l.machine_id, s.machine_id) as machine_id, s.status,
           lead(l.created_at) over w as next_at
    from app.production_logs l join app.job_steps s on s.id = l.job_step_id
    where l.tenant_id = v_tenant and l.created_at < v_to_ts
    window w as (partition by l.job_step_id order by l.created_at, l.id)
  ),
  seg as (   -- running segments clipped to the period
    select machine_id,
           greatest(created_at, v_from_ts) as s_at,
           least(coalesce(next_at, case when status = 'in_progress' then now() end), v_to_ts) as e_at
    from logs
    where action in ('start', 'resume') and machine_id is not null
  ),
  seg_ok as (
    select g.*, k.cal from seg g join mach k on k.id = g.machine_id where g.e_at > g.s_at
  ),
  asg as (
    select a.* from app.machine_assignments a
    where a.tenant_id = v_tenant and a.valid_from < v_to_ts and coalesce(a.valid_to, 'infinity') > v_from_ts
  ),
  piece as (   -- segment ∩ assignment
    select g.machine_id, g.cal, a.profile_id,
           greatest(g.s_at, a.valid_from) as p_s, least(g.e_at, coalesce(a.valid_to, 'infinity')) as p_e
    from seg_ok g join asg a on a.machine_id = g.machine_id
    where greatest(g.s_at, a.valid_from) < least(g.e_at, coalesce(a.valid_to, 'infinity'))
  ),
  piece_w as (
    select p.*, extract(epoch from p.p_e - p.p_s) / 60 as mins,
           extract(epoch from p.p_e - p.p_s) / 60 - app.shift_minutes_between(p.cal, v_tz, p.p_s, p.p_e) as ot,
           1.0 / greatest(1, (select count(*) from asg a2 where a2.machine_id = p.machine_id
                               and a2.valid_from <= p.p_s + (p.p_e - p.p_s) / 2
                               and coalesce(a2.valid_to, 'infinity') > p.p_s + (p.p_e - p.p_s) / 2)) as w
    from piece p
  ),
  machine_run as (
    select machine_id,
           sum(extract(epoch from e_at - s_at) / 60) as run,
           sum(extract(epoch from e_at - s_at) / 60 - app.shift_minutes_between(cal, v_tz, s_at, e_at)) as ot
    from seg_ok group by machine_id
  ),
  machine_staffed as (
    select machine_id, sum(mins * w) as staffed, count(distinct profile_id) as people from piece_w group by machine_id
  ),
  days as (
    select d::date as day from generate_series(p_from::timestamp, v_to::timestamp, interval '1 day') d
  ),
  machine_avail as (
    select k.id as machine_id, sum(app.available_minutes(k.cal, dd.day)) as avail from mach k cross join days dd group by k.id
  ),
  person_day as (   -- longest shift among the machines a person covered that day
    select a.profile_id, dd.day, max(app.available_minutes(k.cal, dd.day)) as mins
    from asg a join mach k on k.id = a.machine_id
    join days dd on a.valid_from < (dd.day + 1)::timestamp at time zone v_tz
                and coalesce(a.valid_to, 'infinity') > dd.day::timestamp at time zone v_tz
    group by a.profile_id, dd.day
  ),
  person_shift as (select profile_id, sum(mins) as shift from person_day group by profile_id),
  person_run as (
    select profile_id, sum(mins * w) as run, sum(greatest(ot, 0) * w) as ot from piece_w group by profile_id
  ),
  people as (
    select pr.id as profile_id, ms.id as membership_id, coalesce(nullif(pr.full_name, ''), u.email::text) as name,
           coalesce(ms.is_active, false) as is_active, coalesce(ms.roles, '{}') as roles
    from app.profiles pr
    join auth.users u on u.id = pr.id
    left join app.memberships ms on ms.user_id = pr.id and ms.tenant_id = v_tenant
    where pr.id in (select profile_id from asg)
       or (ms.is_active and not ms.is_support and 'staff' = any (ms.roles))
  )
  select jsonb_build_object(
    'from', p_from, 'to', v_to,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', p.profile_id, 'membership_id', p.membership_id, 'name', p.name,
               'is_active', p.is_active, 'roles', p.roles,
               'machines', coalesce((select jsonb_agg(distinct k.name) from asg a join mach k on k.id = a.machine_id
                                     where a.profile_id = p.profile_id), '[]'),
               'shift_min', round(coalesce(s.shift, 0)),
               'run_min', round(coalesce(r.run, 0)),
               'ot_min', round(coalesce(r.ot, 0)))
             order by coalesce(r.run, 0) desc, p.name)
      from people p left join person_shift s on s.profile_id = p.profile_id
      left join person_run r on r.profile_id = p.profile_id), '[]'),
    'machines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'machine_id', k.id, 'name', k.name,
               'avail_min', round(coalesce(av.avail, 0)),
               'run_min', round(coalesce(mr.run, 0)),
               'ot_min', round(greatest(coalesce(mr.ot, 0), 0)),
               'unstaffed_min', round(greatest(coalesce(mr.run, 0) - coalesce(st.staffed, 0), 0)),
               'people', coalesce(st.people, 0))
             order by k.sort_order, k.name)
      from mach k
      left join machine_avail av on av.machine_id = k.id
      left join machine_run mr on mr.machine_id = k.id
      left join machine_staffed st on st.machine_id = k.id
      where exists (select 1 from app.machines x where x.id = k.id and x.deleted_at is null and x.status <> 'inactive')
         or mr.run > 0), '[]')
  ) into v_result;
  return v_result;
end
$$;

revoke execute on function api.staffing_report(date, date) from public, anon;
grant execute on function api.staffing_report(date, date) to authenticated;
revoke execute on function app.machine_operators_history(), app.memberships_drop_operators() from public, anon, authenticated;
