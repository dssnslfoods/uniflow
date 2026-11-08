-- Step notes: anyone on the floor (Staff and up) may write a free-text note on a step at any
-- time. A note is not part of the approved flow, so it needs no re-approval and leaves the
-- step's version alone (board moves keep working).
create function api.set_step_note(p_step uuid, p_note text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_step app.job_steps;
  v_note text := nullif(btrim(p_note), '');
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  select * into v_step from app.job_steps where id = p_step and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('step.not_found');
  end if;
  if exists (select 1 from app.jobs where id = v_step.job_id and status in ('completed', 'cancelled')) then
    perform app.fail('step.job_closed');
  end if;
  if length(v_note) > 2000 then
    perform app.fail('step.note_too_long');
  end if;
  if v_note is not distinct from v_step.note then
    return;
  end if;

  perform set_config('app.in_command', 'on', true);
  update app.job_steps set note = v_note where id = p_step;
  perform set_config('app.in_command', 'off', true);
  perform app.log_job(v_step.job_id, 'step_note', jsonb_build_object('step_id', p_step, 'note', v_note));
end
$$;

revoke execute on function api.set_step_note(uuid, text) from public, anon;
grant execute on function api.set_step_note(uuid, text) to authenticated;
