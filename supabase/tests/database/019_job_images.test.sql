-- Job reference photos: Staff adds, everyone reads, uploader or supervisor+ removes.
begin;
\ir ../helpers/auth.sql
select plan(12);

create temp table t_ctx as select tests.tenant(tests.user('owner@i.test'), 'I') as tenant_i;
grant select on t_ctx to public;
select tests.member((select tenant_i from t_ctx), tests.user('staff@i.test'), '{staff}');
select tests.member((select tenant_i from t_ctx), tests.user('staff2@i.test'), '{staff}');
select tests.member((select tenant_i from t_ctx), tests.user('exec@i.test'), '{executive}');

select tests.login(tests.user('owner@i.test'));
insert into app.customers (code, name) values ('C1', 'ลูกค้า');
insert into app.sales_orders (customer_id, customer_po_no, po_date, due_date)
select id, 'PO-1', '2026-11-01', '2026-12-01' from app.customers;
insert into app.sales_order_items (sales_order_id, line_no, description, qty, uom, unit_price)
select id, 1, 'งาน', 100, 'ชิ้น', 1 from app.sales_orders;
select api.confirm_sales_order((select id from app.sales_orders));
create temp table t_job as
select api.create_job((select id from app.sales_orders), 'งาน', null,
  jsonb_build_array(jsonb_build_object('sales_order_item_id', (select id from app.sales_order_items), 'qty', 100))) as id;
grant select on t_job to public;
reset role;
create function tests.img_path(p text) returns text language sql as $$
  select (select tenant_i from t_ctx)::text || '/' || (select id from t_job)::text || '/' || p
$$;
grant execute on function tests.img_path(text) to authenticated;

select tests.login(tests.user('staff@i.test'));
select lives_ok($$ select api.add_job_image((select id from t_job), tests.img_path('a.jpg'), 1600, 1200, 250000) $$, 'staff adds a photo');
select throws_ok($$ select api.add_job_image((select id from t_job), 'other/a.jpg') $$, 'P0001', 'image.bad_path', 'the file must be in this job''s folder');
select throws_ok($$ insert into app.job_images (job_id, file_path) values ((select id from t_job), tests.img_path('x.jpg')) $$, '42501', null, 'no direct inserts');
select is((select count(*)::int from app.job_activity_logs where action = 'image_added'), 1, 'the upload is on the job log');

reset role;
select tests.login(tests.user('exec@i.test'));
select is((select count(*)::int from app.job_images), 1, 'every member sees the photos');
select throws_ok($$ select api.add_job_image((select id from t_job), tests.img_path('b.jpg')) $$, 'P0001', 'auth.forbidden', 'an executive cannot add photos');

reset role;
select tests.login(tests.user('staff2@i.test'));
select throws_ok($$ select api.remove_job_image((select id from app.job_images)) $$, 'P0001', 'auth.forbidden', 'another staff cannot remove it');
select lives_ok($$ select api.add_job_image((select id from t_job), tests.img_path('c.jpg')) $$, 'a second staff adds one');

reset role;
select tests.login(tests.user('staff@i.test'));
select is((select api.remove_job_image((select id from app.job_images where file_path like '%a.jpg'))), tests.img_path('a.jpg'), 'the uploader removes it and gets the file path');

reset role;
select tests.login(tests.user('owner@i.test'));
select lives_ok($$ select api.remove_job_image((select id from app.job_images)) $$, 'a manager removes anyone''s photo');
select is((select count(*)::int from app.job_images), 0, 'no photos left');
select api.cancel_job((select id from t_job), 'ยกเลิก');
select throws_ok($$ select api.add_job_image((select id from t_job), tests.img_path('d.jpg')) $$, 'P0001', 'image.job_closed', 'a closed job takes no photos');

select * from finish();
rollback;
