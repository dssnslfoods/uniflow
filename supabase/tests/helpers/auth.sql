-- Test helpers, created inside each test transaction (rolled back afterwards).
-- Usage:
--   reset role; select tests.login(tests.user('a@x.test'));   -- now acting as that user
-- login() runs the real custom_access_token_hook, so claims match production.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pgtap') then
    create extension if not exists pgtap with schema extensions;
  end if;
end
$$;

create schema tests;
grant usage on schema tests to authenticated;

-- Get-or-create an auth user by email.
create function tests.user(p_email text) returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then
    insert into auth.users (email, raw_user_meta_data)
    values (p_email, jsonb_build_object('full_name', split_part(p_email, '@', 1)))
    returning id into v_id;
  end if;
  return v_id;
end
$$;

-- Must be called while still the superuser (after `reset role`).
create function tests.login(p_user uuid) returns void
language plpgsql
as $$
declare v_claims jsonb;
begin
  v_claims := public.custom_access_token_hook(jsonb_build_object(
    'user_id', p_user,
    'claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aud', 'authenticated')
  )) -> 'claims';
  perform set_config('request.jwt.claims', v_claims::text, true);
  perform set_config('role', 'authenticated', true);
end
$$;

create function tests.logout() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- Superuser-only: make a tenant owned by p_admin, optionally on a plan.
create function tests.tenant(p_admin uuid, p_name text, p_plan text default 'business') returns uuid
language plpgsql
as $$
declare v_tenant uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_admin)::text, true);
  v_tenant := api.create_tenant(p_name);
  update app.tenants set plan_id = p_plan where id = v_tenant;
  perform set_config('request.jwt.claims', '', true);
  return v_tenant;
end
$$;

-- Superuser-only: add a member with roles directly.
create function tests.member(p_tenant uuid, p_user uuid, p_roles app.role[]) returns uuid
language sql
as $$
  insert into app.memberships (tenant_id, user_id, roles)
  values (p_tenant, p_user, p_roles)
  on conflict (tenant_id, user_id) do update set roles = excluded.roles, is_active = true
  returning id
$$;

grant execute on all functions in schema tests to authenticated;
