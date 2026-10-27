-- Platform commands. All api.* functions: security definer, empty search_path,
-- check caller + role first, raise coded errors via app.fail().

create function app.require_role(variadic wanted app.role[]) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.fail('auth.required');
  end if;
  if not app.has_role(variadic wanted) then
    perform app.fail('auth.forbidden');
  end if;
end
$$;

-- Default calendar (Mon–Sat 08:00–12:00, 13:00–17:00) and warehouse for a new tenant.
create function app.init_tenant_defaults(p_tenant uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_calendar uuid;
begin
  insert into app.calendars (tenant_id, name, is_default)
  values (p_tenant, 'กะปกติ', true)
  returning id into v_calendar;

  insert into app.calendar_shifts (tenant_id, calendar_id, weekday, start_time, end_time)
  select p_tenant, v_calendar, d, s.start_time, s.end_time
  from generate_series(1, 6) d
  cross join (values ('08:00'::time, '12:00'::time), ('13:00'::time, '17:00'::time)) s(start_time, end_time);

  insert into app.warehouses (tenant_id, code, name, is_default)
  values (p_tenant, 'MAIN', 'คลังหลัก', true);
end
$$;

-- Onboarding: caller creates a print shop and becomes its admin.
create function api.create_tenant(p_name text) returns uuid
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

  insert into app.tenants (name, created_by) values (trim(p_name), v_user)
  returning id into v_tenant;

  insert into app.memberships (tenant_id, user_id, roles, created_by)
  values (v_tenant, v_user, '{admin,executive,manager}', v_user);

  perform app.init_tenant_defaults(v_tenant);

  update app.profiles set active_tenant_id = v_tenant where id = v_user;
  return v_tenant;
end
$$;

-- Change the tenant used for the next token refresh (client must refreshSession()).
create function api.switch_tenant(p_tenant uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.fail('auth.required');
  end if;
  if not p_tenant = any (app.my_tenant_ids()) then
    perform app.fail('tenant.not_member');
  end if;
  update app.profiles set active_tenant_id = p_tenant where id = auth.uid();
end
$$;

create function api.my_tenants()
returns table (tenant_id uuid, name text, roles app.role[], is_current boolean)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.name, m.roles, t.id = app.tenant_id()
  from app.memberships m
  join app.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.is_active and t.status in ('trial', 'active')
  order by t.name
$$;

-- Add an existing account to the current tenant (email invites come later via Edge Function).
create function api.add_member(p_email text, p_roles app.role[]) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_user   uuid;
  v_id     uuid;
begin
  perform app.require_role('admin');
  if coalesce(cardinality(p_roles), 0) = 0 then
    perform app.fail('member.roles_required');
  end if;

  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    perform app.fail('member.user_not_found');
  end if;

  select id into v_id from app.memberships where tenant_id = v_tenant and user_id = v_user;
  if v_id is null or not (select is_active from app.memberships where id = v_id) then
    perform app.assert_plan_limit(v_tenant, 'users');
  end if;

  insert into app.memberships (tenant_id, user_id, roles, created_by)
  values (v_tenant, v_user, p_roles, auth.uid())
  on conflict (tenant_id, user_id) do update set roles = excluded.roles, is_active = true
  returning id into v_id;
  return v_id;
end
$$;

create function api.set_member_roles(p_membership uuid, p_roles app.role[], p_is_active boolean default true)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
begin
  perform app.require_role('admin');
  if coalesce(cardinality(p_roles), 0) = 0 then
    perform app.fail('member.roles_required');
  end if;

  update app.memberships
  set roles = p_roles, is_active = p_is_active
  where id = p_membership and tenant_id = v_tenant;
  if not found then
    perform app.fail('member.not_found');
  end if;

  if not exists (
    select 1 from app.memberships
    where tenant_id = v_tenant and is_active and 'admin' = any (roles)
  ) then
    perform app.fail('member.last_admin');
  end if;
end
$$;

-- Supervisors may flag a machine for maintenance without editing its specs (G-23).
create function api.set_machine_status(p_machine uuid, p_status app.machine_status) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  update app.machines set status = p_status
  where id = p_machine and tenant_id = app.tenant_id() and deleted_at is null;
  if not found then
    perform app.fail('machine.not_found');
  end if;
end
$$;

revoke execute on all functions in schema api from public, anon;
grant execute on all functions in schema api to authenticated;
revoke execute on function app.init_tenant_defaults(uuid) from public;
