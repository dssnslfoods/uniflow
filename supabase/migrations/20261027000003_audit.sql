-- Append-only audit log (BR-09, NFR: audit cannot be modified).

create table audit.logs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid,
  table_name  text not null,
  record_id   uuid,
  operation   text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id    uuid,
  diff        jsonb not null,
  at          timestamptz not null default now()
);
create index on audit.logs (tenant_id, table_name, record_id, at desc);

-- No one but the trigger writes here; nobody updates or deletes.
revoke all on audit.logs from public, authenticated, anon;
grant select on audit.logs to service_role;

create function audit.capture() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row  jsonb := coalesce(v_new, v_old);
  v_diff jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value))
      into v_diff
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'updated_by')
      and (v_old -> n.key) is distinct from n.value;
    if v_diff is null then
      return new;
    end if;
  else
    v_diff := v_row;
  end if;

  insert into audit.logs (tenant_id, table_name, record_id, operation, actor_id, diff)
  values (
    coalesce((v_row ->> 'tenant_id')::uuid, case when tg_table_name = 'tenants' then (v_row ->> 'id')::uuid end),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    tg_op,
    auth.uid(),
    v_diff
  );
  return coalesce(new, old);
end
$$;

revoke execute on function audit.capture() from public;

create function audit.enable(p_table regclass) returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create trigger audit after insert or update or delete on %s for each row execute function audit.capture()',
    p_table
  );
end
$$;

select audit.enable('app.tenants');
select audit.enable('app.memberships');
