-- Sprint 6: members & machine operators, shop settings, notifications (+ 24h escalation),
-- and the executive summary (D-20).

-- Machine operators: staff assigned to a machine (labor capacity, D-20) ---------------
create table app.machine_operators (
  tenant_id      uuid not null default app.tenant_id(),
  machine_id     uuid not null,
  membership_id  uuid not null,
  primary key (machine_id, membership_id),
  foreign key (tenant_id, machine_id) references app.machines (tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references app.memberships (tenant_id, id) on delete cascade
);
create index on app.machine_operators (tenant_id, membership_id);
select app.apply_tenant_policies('app.machine_operators', '{admin,manager,supervisor}', true);
select audit.enable('app.machine_operators');

-- Staff-only users may run a machine step only on machines they are assigned to,
-- when the machine has operators at all. Supervisors and up may run any step.
create or replace function app.floor_step(p_step uuid) returns app.job_steps
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

-- Members -------------------------------------------------------------------------
create function api.list_members()
returns table (
  membership_id uuid, user_id uuid, email text, full_name text, roles app.role[],
  is_active boolean, is_support boolean, machine_ids uuid[], joined_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_role('admin', 'executive', 'manager', 'supervisor', 'staff');
  return query
  select m.id, m.user_id, u.email::text, p.full_name, m.roles, m.is_active, m.is_support,
         coalesce((select array_agg(o.machine_id) from app.machine_operators o where o.membership_id = m.id), '{}'),
         m.created_at
  from app.memberships m
  join auth.users u on u.id = m.user_id
  left join app.profiles p on p.id = m.user_id
  where m.tenant_id = app.tenant_id()
  order by m.is_support, not m.is_active, p.full_name nulls last, u.email;
end
$$;

-- Shop settings: only known keys, validated (tenants.settings is otherwise free-form) -----
create function api.update_tenant_settings(p_name text default null, p_patch jsonb default '{}')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_set    jsonb;
  v_key    text;
begin
  perform app.require_role('admin');
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('allow_self_approval', 'timezone', 'overhead_pct', 'doc_numbering') then
      perform app.fail('settings.unknown_key', 'Unknown setting: ' || v_key);
    end if;
  end loop;
  if p_patch ? 'allow_self_approval' and jsonb_typeof(p_patch -> 'allow_self_approval') <> 'boolean' then
    perform app.fail('settings.invalid');
  end if;
  if p_patch ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p_patch ->> 'timezone') then
    perform app.fail('settings.invalid_timezone');
  end if;
  if p_patch ? 'overhead_pct' and ((p_patch ->> 'overhead_pct')::numeric < 0 or (p_patch ->> 'overhead_pct')::numeric > 500) then
    perform app.fail('settings.invalid');
  end if;
  if p_patch ? 'doc_numbering' and not (
       coalesce(p_patch #>> '{doc_numbering,year}', 'ad') in ('ad', 'be')
       and coalesce(p_patch #>> '{doc_numbering,reset}', 'yearly') in ('yearly', 'monthly')
       and coalesce((p_patch #>> '{doc_numbering,digits}')::int, 4) between 3 and 8) then
    perform app.fail('settings.invalid');
  end if;

  update app.tenants
  set name = coalesce(nullif(trim(p_name), ''), name),
      settings = settings || p_patch
  where id = v_tenant
  returning settings into v_set;
  return v_set;
end
$$;

-- Notifications (M11) -------------------------------------------------------------
create table app.notifications (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references app.tenants on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null,          -- i18n key: notifications.<kind>
  params      jsonb not null default '{}'::jsonb,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on app.notifications (user_id, tenant_id, created_at desc);
create index on app.notifications (user_id, tenant_id) where read_at is null;

alter table app.notifications enable row level security;
create policy own_read on app.notifications for select to authenticated
  using (user_id = auth.uid() and tenant_id = app.tenant_id());
grant select on app.notifications to authenticated;

-- Active, non-support members holding any of the roles.
create function app.members_with(p_tenant uuid, p_roles app.role[]) returns uuid[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct user_id), '{}')
  from app.memberships
  where tenant_id = p_tenant and is_active and not is_support and roles && p_roles
$$;

-- One notification per user; an unread one of the same kind and link from the last
-- 10 minutes is not repeated (a PO with several jobs raises one alert, not several).
create function app.notify(p_tenant uuid, p_users uuid[], p_kind text, p_params jsonb, p_link text) returns void
language sql
set search_path = ''
as $$
  insert into app.notifications (tenant_id, user_id, kind, params, link)
  select p_tenant, u, p_kind, coalesce(p_params, '{}'), p_link
  from unnest(p_users) u
  where u is not null
    and u is distinct from auth.uid()
    and not exists (
      select 1 from app.notifications n
      where n.user_id = u and n.tenant_id = p_tenant and n.kind = p_kind
        and n.link is not distinct from p_link and n.read_at is null
        and n.created_at > now() - interval '10 minutes')
$$;

create function app.on_approval_notify() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job   app.jobs;
  v_so    app.sales_orders;
  v_sub   uuid;
begin
  select * into v_job from app.jobs where id = new.entity_id;
  select * into v_so from app.sales_orders where id = v_job.sales_order_id;
  if new.action = 'submit' then
    perform app.notify(new.tenant_id, app.members_with(new.tenant_id, '{manager}'), 'approval_requested',
      jsonb_build_object('doc_no', v_so.doc_no), '/approvals');
  elsif new.action in ('approve', 'reject', 'request_change') then
    select actor_id into v_sub from app.approvals
    where entity_id = new.entity_id and action = 'submit' order by version desc, created_at desc limit 1;
    perform app.notify(new.tenant_id, array[v_sub],
      case new.action when 'approve' then 'job_approved' when 'reject' then 'job_rejected' else 'job_change_requested' end,
      jsonb_build_object('job_no', v_job.job_no, 'title', v_job.title, 'reason', new.comment),
      '/orders/' || v_so.id || '/plan');
  end if;
  return new;
end
$$;
create trigger notify after insert on app.approvals for each row execute function app.on_approval_notify();

create function app.on_downtime_notify() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.notify(new.tenant_id, app.members_with(new.tenant_id, '{manager,supervisor}'), 'machine_down',
    jsonb_build_object('machine', (select name from app.machines where id = new.machine_id), 'reason', new.reason),
    '/board');
  return new;
end
$$;
create trigger notify after insert on app.machine_downtimes for each row execute function app.on_downtime_notify();

create function app.on_job_notify() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.is_at_risk and not old.is_at_risk and new.status = 'in_production' then
    perform app.notify(new.tenant_id, app.members_with(new.tenant_id, '{manager,supervisor}'), 'job_at_risk',
      jsonb_build_object('job_no', new.job_no, 'title', new.title, 'due', new.due_date), '/jobs/' || new.id);
  end if;
  if new.status = 'ready_to_deliver' and old.status <> 'ready_to_deliver' then
    perform app.notify(new.tenant_id, app.members_with(new.tenant_id, '{manager,executive}'), 'job_finished',
      jsonb_build_object('job_no', new.job_no, 'title', new.title), '/jobs/' || new.id);
  end if;
  return new;
end
$$;
create trigger notify after update of is_at_risk, status on app.jobs for each row execute function app.on_job_notify();

-- Approvals waiting over 24 h escalate to managers and executives (SRS §7.4), once a day per PO.
create function app.escalate_pending_approvals() returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count int := 0;
begin
  for v_row in
    select j.tenant_id, o.id as so_id, o.doc_no, min(a.created_at) as since
    from app.jobs j
    join app.sales_orders o on o.id = j.sales_order_id
    join lateral (select created_at from app.approvals
                  where entity_id = j.id and action = 'submit' order by version desc limit 1) a on true
    where j.status = 'pending_approval' and a.created_at < now() - interval '24 hours'
    group by j.tenant_id, o.id, o.doc_no
  loop
    continue when exists (
      select 1 from app.notifications
      where tenant_id = v_row.tenant_id and kind = 'approval_overdue' and link = '/approvals'
        and params ->> 'doc_no' = v_row.doc_no and created_at > now() - interval '24 hours');
    insert into app.notifications (tenant_id, user_id, kind, params, link)
    select v_row.tenant_id, u, 'approval_overdue',
           jsonb_build_object('doc_no', v_row.doc_no, 'hours', floor(extract(epoch from now() - v_row.since) / 3600)),
           '/approvals'
    from unnest(app.members_with(v_row.tenant_id, '{manager,executive}')) u;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
revoke execute on function app.escalate_pending_approvals() from public;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('uniflow-escalate-approvals', '15 * * * *', 'select app.escalate_pending_approvals()');
  end if;
end
$$;

create function api.mark_notifications_read(p_ids bigint[] default null) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  if auth.uid() is null then
    perform app.fail('auth.required');
  end if;
  update app.notifications set read_at = now()
  where user_id = auth.uid() and tenant_id = app.tenant_id() and read_at is null
    and (p_ids is null or id = any (p_ids));
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;

-- Executive summary (D-20, FR-10.3) -----------------------------------------------
create function api.dashboard_summary() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_tz     text := app.tenant_tz(app.tenant_id());
  v_today  date := (now() at time zone app.tenant_tz(app.tenant_id()))::date;
  v_from   timestamptz;
begin
  perform app.require_role('admin', 'executive', 'manager', 'supervisor', 'staff');
  v_from := v_today::timestamp at time zone v_tz;

  return jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'open_orders', (select count(*) from app.sales_orders where tenant_id = v_tenant and status in ('confirmed', 'in_progress')),
        'draft_orders', (select count(*) from app.sales_orders where tenant_id = v_tenant and status = 'draft'),
        'planning', count(*) filter (where status = 'planning'),
        'pending_approval', count(*) filter (where status = 'pending_approval'),
        'approved', count(*) filter (where status = 'approved'),
        'in_production', count(*) filter (where status = 'in_production'),
        'at_risk', count(*) filter (where status = 'in_production' and is_at_risk),
        'ready_to_deliver', count(*) filter (where status = 'ready_to_deliver'))
      from app.jobs where tenant_id = v_tenant),

    'today', (
      select jsonb_build_object(
        'good', coalesce(sum(good_qty), 0),
        'waste', coalesce(sum(waste_qty), 0),
        'steps_done', count(*))
      from app.production_logs where tenant_id = v_tenant and action = 'complete' and created_at >= v_from),

    -- Waste % per process, last 7 days (FR-10.3 / KPI 2.4).
    'waste_7d', coalesce((
      select jsonb_agg(x order by x.waste_pct desc) from (
        select p.name as process, sum(l.good_qty) as good, sum(l.waste_qty) as waste,
               round(sum(l.waste_qty) / nullif(sum(l.good_qty) + sum(l.waste_qty), 0) * 100, 1) as waste_pct
        from app.production_logs l
        join app.job_steps s on s.id = l.job_step_id
        join app.processes p on p.id = s.process_id
        where l.tenant_id = v_tenant and l.action = 'complete' and l.created_at >= v_from - interval '6 days'
        group by p.name) x), '[]'),

    -- Downtime minutes by reason, last 7 days (input for "buy a machine vs hire people", D-20).
    'downtime_7d', coalesce((
      select jsonb_agg(x order by x.minutes desc) from (
        select reason, round(sum(extract(epoch from
                 least(coalesce(ended_at, now()), now()) - greatest(started_at, v_from - interval '6 days')) / 60)) as minutes
        from app.machine_downtimes
        where tenant_id = v_tenant and coalesce(ended_at, now()) > v_from - interval '6 days'
        group by reason) x), '[]'),

    'machines_down', coalesce((
      select jsonb_agg(jsonb_build_object('machine', m.name, 'reason', d.reason, 'since', d.started_at))
      from app.machine_downtimes d join app.machines m on m.id = d.machine_id
      where d.tenant_id = v_tenant and d.ended_at is null), '[]'),

    'at_risk_jobs', coalesce((
      select jsonb_agg(x order by x.due_date nulls last) from (
        select j.id, j.job_no, j.title, j.due_date, j.planned_finish_at, c.name as customer
        from app.jobs j
        join app.sales_orders o on o.id = j.sales_order_id
        join app.customers c on c.id = o.customer_id
        where j.tenant_id = v_tenant and j.status = 'in_production' and j.is_at_risk
        limit 10) x), '[]'),

    -- On-time (production) rate: jobs that finished in the last 30 days by their due date.
    'otd_30d', (
      select jsonb_build_object(
        'finished', count(*),
        'on_time', count(*) filter (where (f.finished_at at time zone v_tz)::date <= f.due_date))
      from (
        select j.due_date, max(s.actual_end) as finished_at
        from app.jobs j join app.job_steps s on s.job_id = j.id
        where j.tenant_id = v_tenant and j.status in ('ready_to_deliver', 'partially_delivered', 'completed')
        group by j.id
        having max(s.actual_end) >= now() - interval '30 days') f)
  );
end
$$;

revoke execute on function
  api.list_members(), api.update_tenant_settings(text, jsonb), api.mark_notifications_read(bigint[]), api.dashboard_summary()
from public, anon;
grant execute on function
  api.list_members(), api.update_tenant_settings(text, jsonb), api.mark_notifications_read(bigint[]), api.dashboard_summary()
to authenticated;
