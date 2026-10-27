-- Platform: plans, tenants, profiles, memberships, document numbering.

create table app.plans (
  id          text primary key,
  name        text not null,
  limits      jsonb not null default '{}'::jsonb,   -- {max_users, max_machines}; missing key = unlimited
  sort_order  int not null default 0
);

insert into app.plans (id, name, limits, sort_order) values
  ('trial',    'Trial',    '{"max_users": 5,  "max_machines": 5}',  0),
  ('starter',  'Starter',  '{"max_users": 10, "max_machines": 5}',  1),
  ('pro',      'Pro',      '{"max_users": 30, "max_machines": 15}', 2),
  ('business', 'Business', '{"max_users": 80, "max_machines": 40}', 3);

create table app.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  plan_id     text not null default 'trial' references app.plans,
  status      app.tenant_status not null default 'trial',
  -- timezone, features {proof_gate, stock_gate}, allow_self_approval, overhead_pct,
  -- doc_numbering {year: ad|be, reset: yearly|monthly, digits}
  settings    jsonb not null default jsonb_build_object(
                'timezone', 'Asia/Bangkok',
                'features', jsonb_build_object('proof_gate', false, 'stock_gate', false),
                'allow_self_approval', false,
                'overhead_pct', 0,
                'doc_numbering', jsonb_build_object('year', 'ad', 'reset', 'yearly', 'digits', 4)
              ),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table app.profiles (
  id                uuid primary key references auth.users on delete cascade,
  full_name         text,
  locale            text not null default 'th' check (locale in ('th', 'en')),
  active_tenant_id  uuid references app.tenants on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);

create table app.memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references app.tenants on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  roles       app.role[] not null check (cardinality(roles) > 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (tenant_id, user_id),
  unique (tenant_id, id)
);
create index on app.memberships (user_id) where is_active;

create table app.doc_sequences (
  tenant_id  uuid not null references app.tenants on delete cascade,
  doc_type   text not null,
  period     text not null,
  last_no    int not null,
  primary key (tenant_id, doc_type, period)
);

create trigger touch before update on app.tenants     for each row execute function app.touch_updated();
create trigger touch before update on app.profiles    for each row execute function app.touch_updated();
create trigger touch before update on app.memberships for each row execute function app.touch_updated();

-- Tenants the caller belongs to; security definer so policies can use it without recursion.
create function app.my_tenant_ids() returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(tenant_id), '{}')
  from app.memberships
  where user_id = auth.uid() and is_active
$$;

-- Every new auth user gets a profile.
create function app.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into app.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Plan limits (D-11). kind = 'users' | 'machines'.
create function app.assert_plan_limit(p_tenant uuid, p_kind text) returns void
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
    select count(*) into v_used from app.memberships where tenant_id = p_tenant and is_active;
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

-- Running number per tenant/doc type/period (BR-R10, D-06). Row lock via upsert keeps it gap-free under concurrency.
create function app.next_doc_no(p_doc_type text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := app.tenant_id();
  v_cfg     jsonb;
  v_now     timestamp;
  v_year    int;
  v_period  text;
  v_no      int;
begin
  if v_tenant is null then
    perform app.fail('auth.no_tenant');
  end if;

  select settings into v_cfg from app.tenants where id = v_tenant;
  v_now  := now() at time zone coalesce(v_cfg ->> 'timezone', 'Asia/Bangkok');
  v_year := extract(year from v_now)::int
            + case when v_cfg #>> '{doc_numbering,year}' = 'be' then 543 else 0 end;
  v_period := case when v_cfg #>> '{doc_numbering,reset}' = 'monthly'
                   then v_year::text || to_char(v_now, 'MM')
                   else v_year::text end;

  insert into app.doc_sequences as s (tenant_id, doc_type, period, last_no)
  values (v_tenant, p_doc_type, v_period, 1)
  on conflict (tenant_id, doc_type, period) do update set last_no = s.last_no + 1
  returning last_no into v_no;

  return format('%s-%s-%s', p_doc_type, v_period,
                lpad(v_no::text, coalesce((v_cfg #>> '{doc_numbering,digits}')::int, 4), '0'));
end
$$;

-- RLS ------------------------------------------------------------------------

alter table app.plans         enable row level security;
alter table app.tenants       enable row level security;
alter table app.profiles      enable row level security;
alter table app.memberships   enable row level security;
alter table app.doc_sequences enable row level security;

create policy plans_read on app.plans for select to authenticated using (true);

create policy tenants_read on app.tenants for select to authenticated
  using (id = any (app.my_tenant_ids()));
create policy tenants_admin_update on app.tenants for update to authenticated
  using (id = app.tenant_id() and app.has_role('admin'))
  with check (id = app.tenant_id());

create policy profiles_read on app.profiles for select to authenticated
  using (
    id = auth.uid()
    or id in (select user_id from app.memberships where tenant_id = app.tenant_id())
  );
create policy profiles_update_own on app.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy memberships_read on app.memberships for select to authenticated
  using (tenant_id = app.tenant_id() or user_id = auth.uid());

-- doc_sequences: no client policies (only next_doc_no touches it).

grant select on app.plans, app.tenants, app.profiles, app.memberships to authenticated;
-- Tenant admins may rename and change settings, never plan/status (platform-managed).
grant update (name, settings) on app.tenants to authenticated;
-- active_tenant_id only changes through api.switch_tenant.
grant update (full_name, locale) on app.profiles to authenticated;

revoke execute on function app.handle_new_user() from public;
revoke execute on function app.assert_plan_limit(uuid, text) from public;
revoke execute on function app.next_doc_no(text) from public;
grant execute on function app.next_doc_no(text) to authenticated;
