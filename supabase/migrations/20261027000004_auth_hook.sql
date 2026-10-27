-- Custom Access Token Hook: put the active tenant and its roles into the JWT
-- so RLS reads claims instead of joining memberships on every row.
-- Enabled in config.toml [auth.hook.custom_access_token].

create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user    uuid := (event ->> 'user_id')::uuid;
  v_claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_tenant  uuid;
  v_roles   app.role[];
begin
  -- Preferred tenant, if the membership is still active.
  select m.tenant_id, m.roles into v_tenant, v_roles
  from app.profiles p
  join app.memberships m on m.tenant_id = p.active_tenant_id and m.user_id = p.id and m.is_active
  join app.tenants t on t.id = m.tenant_id and t.status in ('trial', 'active')
  where p.id = v_user;

  -- Otherwise fall back to the oldest active membership.
  if v_tenant is null then
    select m.tenant_id, m.roles into v_tenant, v_roles
    from app.memberships m
    join app.tenants t on t.id = m.tenant_id and t.status in ('trial', 'active')
    where m.user_id = v_user and m.is_active
    order by m.created_at
    limit 1;
  end if;

  v_claims := v_claims
    || jsonb_build_object(
         'tenant_id', v_tenant,
         'roles', to_jsonb(coalesce(v_roles, '{}'::app.role[]))
       );

  return jsonb_set(event, '{claims}', v_claims);
end
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema app to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
