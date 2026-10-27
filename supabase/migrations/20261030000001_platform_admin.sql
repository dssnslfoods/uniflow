-- Platform (SaaS operator) super admins: manage every tenant without being a tenant role.
-- Membership in app.platform_admins is granted by SQL only — there is no API to add one.

create table app.platform_admins (
  user_id     uuid primary key references auth.users on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);
alter table app.platform_admins enable row level security;
create policy own_row on app.platform_admins for select to authenticated using (user_id = auth.uid());
grant select on app.platform_admins to authenticated;
select audit.enable('app.platform_admins');

-- Support memberships: a super admin entering a tenant. Visible to the tenant, never billed.
alter table app.memberships add column is_support boolean not null default false;

create function app.is_platform_admin() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'platform_admin')::boolean, false)
$$;

-- JWT: add platform_admin to the claims produced by the tenant hook.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user    uuid := (event ->> 'user_id')::uuid;
  v_claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_tenant  uuid;
  v_roles   app.role[];
begin
  select m.tenant_id, m.roles into v_tenant, v_roles
  from app.profiles p
  join app.memberships m on m.tenant_id = p.active_tenant_id and m.user_id = p.id and m.is_active
  join app.tenants t on t.id = m.tenant_id and t.status in ('trial', 'active')
  where p.id = v_user;

  if v_tenant is null then
    select m.tenant_id, m.roles into v_tenant, v_roles
    from app.memberships m
    join app.tenants t on t.id = m.tenant_id and t.status in ('trial', 'active')
    where m.user_id = v_user and m.is_active and not m.is_support
    order by m.created_at
    limit 1;
  end if;

  v_claims := v_claims
    || jsonb_build_object(
         'tenant_id', v_tenant,
         'roles', to_jsonb(coalesce(v_roles, '{}'::app.role[])),
         'platform_admin', exists (select 1 from app.platform_admins where user_id = v_user)
       );

  return jsonb_set(event, '{claims}', v_claims);
end
$$;

-- Support members are not billed and do not count as the tenant's own admins.
create or replace function app.assert_plan_limit(p_tenant uuid, p_kind text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_used  int;
begin
  select (p.limits ->> ('max_' || p_kind))::int into v_limit
  from app.tenants t join app.plans p on p.id = t.plan_id
  where t.id = p_tenant;

  if v_limit is null then
    return;
  end if;

  if p_kind = 'users' then
    select count(*) into v_used from app.memberships where tenant_id = p_tenant and is_active and not is_support;
  elsif p_kind = 'machines' then
    execute 'select count(*) from app.machines where tenant_id = $1 and deleted_at is null'
      into v_used using p_tenant;
  else
    perform app.fail('plan.unknown_limit');
  end if;

  if v_used >= v_limit then
    perform app.fail('plan.limit_reached', format('Plan limit reached: %s %s', v_limit, p_kind));
  end if;
end
$$;

create or replace function api.set_member_roles(p_membership uuid, p_roles app.role[], p_is_active boolean default true)
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
  where id = p_membership and tenant_id = v_tenant and not is_support;
  if not found then
    perform app.fail('member.not_found');
  end if;

  if not exists (
    select 1 from app.memberships
    where tenant_id = v_tenant and is_active and not is_support and 'admin' = any (roles)
  ) then
    perform app.fail('member.last_admin');
  end if;
end
$$;

-- Commands (platform admin only) ---------------------------------------------

create function app.require_platform_admin() returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.fail('auth.required');
  end if;
  -- Check the table, not only the claim, so a revoked admin loses access before the token expires.
  if not exists (select 1 from app.platform_admins where user_id = auth.uid()) then
    perform app.fail('auth.forbidden');
  end if;
end
$$;

create function api.admin_list_tenants()
returns table (
  tenant_id uuid, name text, plan_id text, status app.tenant_status, created_at timestamptz,
  members int, machines int, open_orders int, active_jobs int, owner_email text, supporting boolean
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return query
  select t.id, t.name, t.plan_id, t.status, t.created_at,
         (select count(*)::int from app.memberships m where m.tenant_id = t.id and m.is_active and not m.is_support),
         (select count(*)::int from app.machines x where x.tenant_id = t.id and x.deleted_at is null),
         (select count(*)::int from app.sales_orders o where o.tenant_id = t.id and o.status in ('draft', 'confirmed', 'in_progress')),
         (select count(*)::int from app.jobs j where j.tenant_id = t.id and j.status not in ('completed', 'cancelled')),
         (select u.email::text from app.memberships m join auth.users u on u.id = m.user_id
           where m.tenant_id = t.id and not m.is_support and 'admin' = any (m.roles) order by m.created_at limit 1),
         exists (select 1 from app.memberships m where m.tenant_id = t.id and m.user_id = auth.uid() and m.is_support and m.is_active)
  from app.tenants t
  order by t.created_at desc;
end
$$;

create function api.admin_update_tenant(p_tenant uuid, p_plan text default null, p_status app.tenant_status default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  update app.tenants
  set plan_id = coalesce(p_plan, plan_id),
      status = coalesce(p_status, status)
  where id = p_tenant;
  if not found then
    perform app.fail('tenant.not_found');
  end if;
end
$$;

-- Enter a tenant for support: a flagged membership + make it the active tenant (client refreshes the session).
create function api.admin_enter_tenant(p_tenant uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  if not exists (select 1 from app.tenants where id = p_tenant) then
    perform app.fail('tenant.not_found');
  end if;

  insert into app.memberships (tenant_id, user_id, roles, is_support, created_by)
  values (p_tenant, auth.uid(), '{admin,executive,manager}', true, auth.uid())
  on conflict (tenant_id, user_id) do update
    set is_active = true,
        -- never downgrade a real membership the admin already holds
        roles = case when app.memberships.is_support then excluded.roles else app.memberships.roles end;

  update app.profiles set active_tenant_id = p_tenant where id = auth.uid();
end
$$;

create function api.admin_leave_tenant(p_tenant uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  update app.memberships set is_active = false
  where tenant_id = p_tenant and user_id = auth.uid() and is_support;
  update app.profiles set active_tenant_id = null
  where id = auth.uid() and active_tenant_id = p_tenant;
end
$$;

revoke execute on function
  api.admin_list_tenants(), api.admin_update_tenant(uuid, text, app.tenant_status),
  api.admin_enter_tenant(uuid), api.admin_leave_tenant(uuid)
from public, anon;
grant execute on function
  api.admin_list_tenants(), api.admin_update_tenant(uuid, text, app.tenant_status),
  api.admin_enter_tenant(uuid), api.admin_leave_tenant(uuid)
to authenticated;

-- my_tenants now tells the app when the current tenant is a support session (banner in the UI).
drop function api.my_tenants();
create function api.my_tenants()
returns table (tenant_id uuid, name text, roles app.role[], is_current boolean, is_support boolean)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.name, m.roles, t.id = app.tenant_id(), m.is_support
  from app.memberships m
  join app.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid() and m.is_active and t.status in ('trial', 'active')
  order by m.is_support, t.name
$$;
revoke execute on function api.my_tenants() from public, anon;
grant execute on function api.my_tenants() to authenticated;
