-- Reference photos on a job (shrunk in the browser before upload). Every member reads them at
-- any stage of the flow; Staff and up add them; the uploader or a supervisor+ removes them.
-- Photos are reference only: they change nothing in the approved flow.
create table app.job_images (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app.tenant_id() references app.tenants on delete cascade,
  job_id      uuid not null,
  file_path   text not null,
  width       int check (width > 0),
  height      int check (height > 0),
  size_bytes  int check (size_bytes > 0),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (file_path),
  foreign key (tenant_id, job_id) references app.jobs (tenant_id, id) on delete cascade
);
create index on app.job_images (tenant_id, job_id, created_at);

alter table app.job_images enable row level security;
create policy tenant_read on app.job_images for select to authenticated using (tenant_id = app.tenant_id());
grant select on app.job_images to authenticated;

create function api.add_job_image(p_job uuid, p_file_path text, p_width int default null, p_height int default null, p_size_bytes int default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job app.jobs;
  v_id uuid;
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  select * into v_job from app.jobs where id = p_job and tenant_id = app.tenant_id();
  if not found then
    perform app.fail('job.not_found');
  end if;
  if v_job.status in ('completed', 'cancelled') then
    perform app.fail('image.job_closed');
  end if;
  -- The file must sit in this shop's folder for this job.
  if p_file_path is null or p_file_path not like v_job.tenant_id::text || '/' || p_job::text || '/%' then
    perform app.fail('image.bad_path');
  end if;
  if (select count(*) from app.job_images where job_id = p_job) >= 30 then
    perform app.fail('image.too_many');
  end if;

  insert into app.job_images (tenant_id, job_id, file_path, width, height, size_bytes)
  values (v_job.tenant_id, p_job, p_file_path, p_width, p_height, p_size_bytes)
  returning id into v_id;
  perform app.log_job(p_job, 'image_added', jsonb_build_object('image_id', v_id));
  return v_id;
end
$$;

create function api.remove_job_image(p_image uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_img app.job_images;
begin
  perform app.require_role('admin', 'manager', 'supervisor', 'staff');
  select * into v_img from app.job_images where id = p_image and tenant_id = app.tenant_id();
  if not found then
    perform app.fail('image.not_found');
  end if;
  if v_img.created_by is distinct from auth.uid() and not app.has_role('admin', 'manager', 'supervisor') then
    perform app.fail('auth.forbidden');
  end if;
  delete from app.job_images where id = p_image;
  perform app.log_job(v_img.job_id, 'image_removed', jsonb_build_object('image_id', p_image));
  return v_img.file_path;   -- the caller removes the file from Storage
end
$$;

revoke execute on function api.add_job_image(uuid, text, int, int, int), api.remove_job_image(uuid) from public, anon;
grant execute on function api.add_job_image(uuid, text, int, int, int), api.remove_job_image(uuid) to authenticated;

-- Files (Storage). Path: <tenant_id>/<job_id>/<file>. Skipped where Storage is absent (local tests).
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('job-images', 'job-images', false, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
  on conflict (id) do nothing;

  create policy job_images_read on storage.objects for select to authenticated
    using (bucket_id = 'job-images' and (storage.foldername(name))[1] = app.tenant_id()::text);
  create policy job_images_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'job-images' and (storage.foldername(name))[1] = app.tenant_id()::text
                and app.has_role('admin', 'manager', 'supervisor', 'staff'));
  -- Only files no longer listed on a job may be deleted (remove_job_image drops the row first).
  create policy job_images_delete on storage.objects for delete to authenticated
    using (bucket_id = 'job-images' and (storage.foldername(name))[1] = app.tenant_id()::text
           and app.has_role('admin', 'manager', 'supervisor', 'staff')
           and not exists (select 1 from app.job_images i where i.file_path = storage.objects.name));
end
$$;
