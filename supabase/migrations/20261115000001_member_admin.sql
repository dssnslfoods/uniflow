-- Shop admins manage their own people: rename, set a password, remove from the shop.
-- Accounts are global (one login can belong to several shops), so an admin may change a person's
-- name or password only when that person belongs to no other shop. Removing someone only ends
-- their membership here; the login itself stays.

-- True when the user's only memberships are in this tenant.
create function app.member_only_here(p_user uuid, p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from app.memberships where user_id = p_user and tenant_id <> p_tenant)
$$;
revoke execute on function app.member_only_here(uuid, uuid) from public;

-- Membership in the caller's shop that the caller (an admin) may manage; never support staff.
create function app.managed_member(p_membership uuid) returns app.memberships
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_member app.memberships;
begin
  perform app.require_role('admin');
  select * into v_member from app.memberships where id = p_membership and tenant_id = app.tenant_id() and not is_support;
  if not found then
    perform app.fail('member.not_found');
  end if;
  return v_member;
end
$$;
revoke execute on function app.managed_member(uuid) from public;

-- list_members gains only_here so the screen knows whose account details the admin may change.
drop function api.list_members();
create function api.list_members()
returns table (
  membership_id uuid, user_id uuid, email text, full_name text, roles app.role[],
  is_active boolean, is_support boolean, machine_ids uuid[], joined_at timestamptz, only_here boolean
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_role('admin', 'executive', 'manager', 'supervisor', 'staff');
  return query
  select m.id, m.user_id, u.email::text, p.full_name, m.roles, m.is_active, m.is_support,
         coalesce((select array_agg(o.machine_id) from app.machine_operators o where o.membership_id = m.id), '{}'),
         m.created_at, app.member_only_here(m.user_id, m.tenant_id)
  from app.memberships m
  join auth.users u on u.id = m.user_id
  left join app.profiles p on p.id = m.user_id
  where m.tenant_id = app.tenant_id()
  order by m.is_support, not m.is_active, p.full_name nulls last, u.email;
end
$$;

create function api.set_member_name(p_membership uuid, p_full_name text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_member app.memberships := app.managed_member(p_membership);
begin
  if not app.member_only_here(v_member.user_id, v_member.tenant_id) then
    perform app.fail('member.shared_account');
  end if;
  insert into app.profiles (id, full_name) values (v_member.user_id, nullif(btrim(p_full_name), ''))
  on conflict (id) do update set full_name = excluded.full_name;
end
$$;

-- Called by the manage-member Edge Function before it sets a password with the service role:
-- returns the user to change, or fails.
create function api.assert_can_set_password(p_membership uuid) returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_member app.memberships := app.managed_member(p_membership);
begin
  if v_member.user_id = auth.uid() then
    perform app.fail('member.use_own_settings');
  end if;
  if not app.member_only_here(v_member.user_id, v_member.tenant_id) then
    perform app.fail('member.shared_account');
  end if;
  return v_member.user_id;
end
$$;

create function api.remove_member(p_membership uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_member app.memberships := app.managed_member(p_membership);
begin
  if v_member.user_id = auth.uid() then
    perform app.fail('member.cannot_remove_self');
  end if;
  delete from app.memberships where id = p_membership;
  if not exists (
    select 1 from app.memberships
    where tenant_id = v_member.tenant_id and is_active and not is_support and 'admin' = any (roles)
  ) then
    perform app.fail('member.last_admin');
  end if;
  update app.profiles set active_tenant_id = null where id = v_member.user_id and active_tenant_id = v_member.tenant_id;
end
$$;

revoke execute on function
  api.list_members(), api.set_member_name(uuid, text), api.assert_can_set_password(uuid), api.remove_member(uuid)
from public, anon;
grant execute on function
  api.list_members(), api.set_member_name(uuid, text), api.assert_can_set_password(uuid), api.remove_member(uuid)
to authenticated;
