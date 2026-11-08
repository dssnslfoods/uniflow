-- One person looks after one machine at a time (user rule, 2026-11-08).
-- Putting someone on a new machine moves them: the old period closes, a new one opens.

-- Existing people on several machines keep only their most recent assignment
-- (ties: the first machine in board order). Deleting closes their history through the trigger.
delete from app.machine_operators o
using (
  select o2.machine_id, o2.membership_id,
         row_number() over (
           partition by o2.membership_id
           order by (select max(a.valid_from) from app.machine_assignments a
                     where a.machine_id = o2.machine_id and a.membership_id = o2.membership_id and a.valid_to is null) desc nulls last,
                    m.sort_order, m.name) as rn
  from app.machine_operators o2 join app.machines m on m.id = o2.machine_id
) x
where x.machine_id = o.machine_id and x.membership_id = o.membership_id and x.rn > 1;

create unique index machine_operators_one_machine on app.machine_operators (membership_id);
create unique index machine_assignments_one_open_per_person
  on app.machine_assignments (tenant_id, profile_id) where valid_to is null;

-- Assign, move or take off in one step. p_machine null = take off every machine.
create function api.assign_operator(p_membership uuid, p_machine uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  if not exists (select 1 from app.memberships where id = p_membership and tenant_id = v_tenant and is_active) then
    perform app.fail('member.not_found');
  end if;
  if p_machine is not null and not exists (
    select 1 from app.machines where id = p_machine and tenant_id = v_tenant and deleted_at is null and status <> 'inactive'
  ) then
    perform app.fail('machine.not_found');
  end if;
  if exists (select 1 from app.machine_operators where membership_id = p_membership and machine_id is not distinct from p_machine) then
    return;   -- already there
  end if;
  delete from app.machine_operators where membership_id = p_membership;
  if p_machine is not null then
    insert into app.machine_operators (tenant_id, machine_id, membership_id) values (v_tenant, p_machine, p_membership);
  end if;
end
$$;

revoke execute on function api.assign_operator(uuid, uuid) from public, anon;
grant execute on function api.assign_operator(uuid, uuid) to authenticated;
