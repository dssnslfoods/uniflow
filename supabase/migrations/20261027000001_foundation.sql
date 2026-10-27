-- Uniflow foundation: schemas, enums, shared helpers.
-- app   = tables (read through RLS)
-- api   = commands (security definer RPC)
-- audit = append-only change log

create schema if not exists app;
create schema if not exists api;
create schema if not exists audit;

grant usage on schema app, api to authenticated, service_role;
grant usage on schema audit to service_role;

create type app.role as enum ('admin', 'executive', 'manager', 'supervisor', 'staff');
create type app.tenant_status as enum ('trial', 'active', 'suspended', 'closed');
create type app.machine_status as enum ('active', 'maintenance', 'inactive');
create type app.step_type as enum ('design', 'internal', 'outsource', 'qc', 'delivery');
create type app.capacity_unit as enum ('sheet', 'impression', 'piece', 'meter', 'kg');

-- Claims come from the custom access token hook (see _auth_hook.sql).
create function app.tenant_id() returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

create function app.roles() returns app.role[]
language sql stable
set search_path = ''
as $$
  select coalesce(
    array(select jsonb_array_elements_text(auth.jwt() -> 'roles'))::app.role[],
    '{}'::app.role[]
  )
$$;

create function app.has_role(variadic wanted app.role[]) returns boolean
language sql stable
set search_path = ''
as $$
  select app.tenant_id() is not null and app.roles() && wanted
$$;

-- Raises a coded error the client translates (detail = i18n key).
create function app.fail(code text, message text default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', coalesce(message, code) using errcode = 'P0001', detail = code;
end
$$;

create function app.touch_updated() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end
$$;
