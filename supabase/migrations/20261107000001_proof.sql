-- Phase 2, part 3: artwork proofs (FR-6.1–6.3, BR-R06, D-01).
-- The designer uploads a proof version; staff record the customer's decision. With the shop's
-- proof_gate on, a design step cannot be finished until the job has an approved proof, so the
-- steps after it (plates, print) wait for the customer.

create type app.proof_status as enum ('pending', 'approved', 'rejected', 'superseded');

create table app.proofs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default app.tenant_id() references app.tenants on delete cascade,
  job_id            uuid not null,
  version           smallint not null check (version > 0),
  file_path         text,
  file_name         text,
  note              text,
  status            app.proof_status not null default 'pending',
  submitted_by      uuid default auth.uid(),
  submitted_at      timestamptz not null default now(),
  decided_by        uuid,
  decided_at        timestamptz,
  customer_name     text,
  customer_comment  text,
  unique (tenant_id, id),
  unique (job_id, version),
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id) on delete cascade
);
create index on app.proofs (tenant_id, status, submitted_at desc);
-- One proof waiting for the customer per job.
create unique index proofs_one_pending on app.proofs (job_id) where status = 'pending';

alter table app.proofs enable row level security;
create policy tenant_read on app.proofs for select to authenticated using (tenant_id = app.tenant_id());
grant select on app.proofs to authenticated;
select audit.enable('app.proofs');

-- Gate state for one shop.
create function app.proof_gate_on(p_tenant uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((settings #>> '{features,proof_gate}')::boolean, false) and app.module_enabled(id, 'proof')
  from app.tenants where id = p_tenant
$$;

-- BR-R06: with the gate on, a design step finishes only once the customer approved a proof.
create function app.on_design_done() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status <> 'done' and new.step_type = 'design'
     and app.proof_gate_on(new.tenant_id)
     and not exists (select 1 from app.proofs p where p.job_id = new.job_id and p.status = 'approved') then
    perform app.fail('proof.not_approved', 'The customer has not approved a proof for this job');
  end if;
  return new;
end
$$;
create trigger proof_gate before update of status on app.job_steps for each row execute function app.on_design_done();

-- Commands -------------------------------------------------------------------------

-- New proof version (FR-6.1). An older proof still waiting is superseded.
create function api.submit_proof(p_job uuid, p_file_path text, p_file_name text default null, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job app.jobs;
  v_id  uuid;
  v_ver smallint;
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  perform app.require_module('proof');
  select * into v_job from app.jobs where id = p_job and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('job.not_found');
  end if;
  if v_job.status in ('completed', 'cancelled') then
    perform app.fail('proof.job_closed');
  end if;
  if coalesce(trim(p_file_path), '') = '' then
    perform app.fail('proof.file_required');
  end if;
  if split_part(p_file_path, '/', 1) <> v_job.tenant_id::text then
    perform app.fail('proof.file_required');
  end if;

  update app.proofs set status = 'superseded' where job_id = p_job and status = 'pending';
  select coalesce(max(version), 0) + 1 into v_ver from app.proofs where job_id = p_job;
  insert into app.proofs (tenant_id, job_id, version, file_path, file_name, note)
  values (v_job.tenant_id, p_job, v_ver, p_file_path, nullif(trim(p_file_name), ''), nullif(trim(p_note), ''))
  returning id into v_id;

  perform app.log_job(p_job, 'proof_submitted', jsonb_build_object('version', v_ver));
  perform app.notify(v_job.tenant_id, app.members_with(v_job.tenant_id, '{manager,supervisor}'), 'proof_submitted',
    jsonb_build_object('job_no', v_job.job_no, 'title', v_job.title, 'version', v_ver), '/jobs/' || p_job);
  return v_id;
end
$$;

-- The customer's answer, recorded by the shop (FR-6.2/6.3). A rejection needs the customer's comment.
create function api.decide_proof(p_proof uuid, p_approved boolean, p_customer_name text default null, p_comment text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p   app.proofs;
  v_job app.jobs;
begin
  perform app.require_role('admin', 'manager', 'supervisor');
  perform app.require_module('proof');
  select * into v_p from app.proofs where id = p_proof and tenant_id = app.tenant_id() for update;
  if not found then
    perform app.fail('proof.not_found');
  end if;
  if v_p.status <> 'pending' then
    perform app.fail('proof.not_pending');
  end if;
  if not p_approved and coalesce(trim(p_comment), '') = '' then
    perform app.fail('proof.comment_required');
  end if;

  update app.proofs
  set status = case when p_approved then 'approved' else 'rejected' end::app.proof_status,
      decided_by = auth.uid(), decided_at = now(),
      customer_name = nullif(trim(p_customer_name), ''), customer_comment = nullif(trim(p_comment), '')
  where id = p_proof;

  select * into v_job from app.jobs where id = v_p.job_id;
  perform app.log_job(v_job.id, case when p_approved then 'proof_approved' else 'proof_rejected' end,
    jsonb_build_object('version', v_p.version, 'reason', nullif(trim(p_comment), '')));
  perform app.notify(v_job.tenant_id,
    array(select distinct u from unnest(app.members_with(v_job.tenant_id, '{supervisor}') || v_p.submitted_by) u where u is not null),
    case when p_approved then 'proof_approved' else 'proof_rejected' end,
    jsonb_build_object('job_no', v_job.job_no, 'title', v_job.title, 'version', v_p.version), '/jobs/' || v_job.id);
end
$$;

revoke execute on function api.submit_proof(uuid, text, text, text), api.decide_proof(uuid, boolean, text, text) from public, anon;
grant execute on function api.submit_proof(uuid, text, text, text), api.decide_proof(uuid, boolean, text, text) to authenticated;

-- Proof files (Storage). Path: <tenant_id>/<job_id>/<file>. Skipped where Storage is absent (local tests).
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('proof-files', 'proof-files', false, 52428800, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

  create policy proof_files_read on storage.objects for select to authenticated
    using (bucket_id = 'proof-files' and (storage.foldername(name))[1] = app.tenant_id()::text);
  create policy proof_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'proof-files' and (storage.foldername(name))[1] = app.tenant_id()::text
                and app.has_role('admin', 'manager', 'supervisor', 'staff'));
end
$$;

-- Realtime refresh for proof changes.
do $$
begin
  if to_regproc('realtime.send') is not null then
    create trigger broadcast after insert or update on app.proofs for each statement execute function app.broadcast_board();
  end if;
end
$$;
