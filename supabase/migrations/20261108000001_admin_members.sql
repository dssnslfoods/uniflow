-- Platform console: super admins open shops, give each shop its admins and choose its modules.
-- Shop admins then add their own people (api.add_member / invite-member) as before.

-- New shop without making the platform admin a member of it.
create function api.admin_create_tenant(p_name text, p_plan text default 'trial', p_modules text[] default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_platform_admin();
  if coalesce(length(trim(p_name)), 0) = 0 then
    perform app.fail('tenant.name_required');
  end if;
  if not exists (select 1 from app.plans where id = p_plan) then
    perform app.fail('tenant.unknown_plan');
  end if;

  insert into app.tenants (name, plan_id, created_by) values (trim(p_name), p_plan, auth.uid())
  returning id into v_tenant;
  perform app.init_tenant_defaults(v_tenant);
  if p_modules is not null then
    perform api.admin_set_modules(v_tenant, p_modules);
  end if;
  return v_tenant;
end
$$;

-- People of any shop (support sessions hidden).
create function api.admin_list_members(p_tenant uuid)
returns table (
  membership_id uuid, user_id uuid, email text, full_name text, roles app.role[],
  is_active boolean, joined_at timestamptz, last_sign_in_at timestamptz, invited_pending boolean
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  if not exists (select 1 from app.tenants where id = p_tenant) then
    perform app.fail('tenant.not_found');
  end if;
  return query
  select m.id, m.user_id, u.email::text, p.full_name, m.roles, m.is_active, m.created_at,
         u.last_sign_in_at, u.last_sign_in_at is null
  from app.memberships m
  join auth.users u on u.id = m.user_id
  left join app.profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant and not m.is_support
  order by not m.is_active, not ('admin' = any (m.roles)), u.email;
end
$$;

-- Add an existing account to a shop (the invite-member function creates new accounts first).
create function api.admin_add_member(p_tenant uuid, p_email text, p_roles app.role[]) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_id   uuid;
begin
  perform app.require_platform_admin();
  if not exists (select 1 from app.tenants where id = p_tenant) then
    perform app.fail('tenant.not_found');
  end if;
  if coalesce(cardinality(p_roles), 0) = 0 then
    perform app.fail('member.roles_required');
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    perform app.fail('member.user_not_found');
  end if;

  select id into v_id from app.memberships where tenant_id = p_tenant and user_id = v_user;
  if v_id is null or not (select is_active from app.memberships where id = v_id) then
    perform app.assert_plan_limit(p_tenant, 'users');
  end if;

  insert into app.memberships (tenant_id, user_id, roles, created_by)
  values (p_tenant, v_user, p_roles, auth.uid())
  on conflict (tenant_id, user_id) do update set roles = excluded.roles, is_active = true, is_support = false
  returning id into v_id;
  return v_id;
end
$$;

-- Change roles or deactivate; a shop always keeps one active admin.
create function api.admin_set_member(p_membership uuid, p_roles app.role[], p_is_active boolean default true) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_platform_admin();
  if coalesce(cardinality(p_roles), 0) = 0 then
    perform app.fail('member.roles_required');
  end if;
  update app.memberships set roles = p_roles, is_active = p_is_active
  where id = p_membership and not is_support
  returning tenant_id into v_tenant;
  if v_tenant is null then
    perform app.fail('member.not_found');
  end if;
  if not exists (select 1 from app.memberships where tenant_id = v_tenant and is_active and not is_support and 'admin' = any (roles)) then
    perform app.fail('member.last_admin');
  end if;
end
$$;

revoke execute on function
  api.admin_create_tenant(text, text, text[]), api.admin_list_members(uuid),
  api.admin_add_member(uuid, text, app.role[]), api.admin_set_member(uuid, app.role[], boolean)
from public, anon;
grant execute on function
  api.admin_create_tenant(text, text, text[]), api.admin_list_members(uuid),
  api.admin_add_member(uuid, text, app.role[]), api.admin_set_member(uuid, app.role[], boolean)
to authenticated;
