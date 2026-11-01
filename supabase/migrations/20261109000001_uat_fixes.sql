-- Fixes from the full-system UAT (1 Nov 2026).

-- A machine with unfinished released work cannot be archived: the board only shows live machines,
-- so its cards would disappear with no way to move them.
create function app.guard_machine_archive() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and exists (
    select 1
    from app.job_steps s
    join app.jobs j on j.id = s.job_id
    where s.machine_id = new.id
      and s.status in ('pending', 'ready', 'in_progress', 'paused')
      and j.status not in ('planning', 'completed', 'cancelled')
  ) then
    perform app.fail('machine.has_queue');
  end if;
  return new;
end
$$;

create trigger guard_archive before update of deleted_at on app.machines
  for each row execute function app.guard_machine_archive();

-- People of a suspended shop must be told so; onboarding must not become a way around the suspension.
create function api.my_suspended_tenants()
returns table (tenant_id uuid, name text)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.name
  from app.memberships m
  join app.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.is_active and not m.is_support and t.status = 'suspended'
  order by t.name
$$;

revoke execute on function api.my_suspended_tenants() from public, anon;
grant execute on function api.my_suspended_tenants() to authenticated;

create or replace function api.create_tenant(p_name text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_tenant uuid;
begin
  if v_user is null then
    perform app.fail('auth.required');
  end if;
  if coalesce(length(trim(p_name)), 0) = 0 then
    perform app.fail('tenant.name_required');
  end if;
  if exists (select 1 from api.my_suspended_tenants()) then
    perform app.fail('tenant.suspended');
  end if;

  insert into app.tenants (name, created_by) values (trim(p_name), v_user)
  returning id into v_tenant;

  insert into app.memberships (tenant_id, user_id, roles, created_by)
  values (v_tenant, v_user, '{admin,executive,manager}', v_user);

  perform app.init_tenant_defaults(v_tenant);

  update app.profiles set active_tenant_id = v_tenant where id = v_user;
  return v_tenant;
end
$$;

-- invite-member calls this before sending anything, so an invitation never goes out for a seat
-- the plan does not have. Without p_tenant: the caller's shop (admin). With it: any shop (platform admin).
create function api.assert_can_invite(p_email text, p_tenant uuid default null) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := coalesce(p_tenant, app.tenant_id());
begin
  if p_tenant is null then
    perform app.require_role('admin');
  else
    perform app.require_platform_admin();
  end if;

  -- Same rule as add_member: only a person who is not an active member takes a new seat.
  if not exists (
    select 1
    from app.memberships m
    join auth.users u on u.id = m.user_id
    where m.tenant_id = v_tenant and m.is_active and lower(u.email) = lower(trim(p_email))
  ) then
    perform app.assert_plan_limit(v_tenant, 'users');
  end if;
end
$$;

revoke execute on function api.assert_can_invite(text, uuid) from public, anon;
grant execute on function api.assert_can_invite(text, uuid) to authenticated;
