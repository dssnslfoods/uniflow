-- Step notes: Staff writes them any time before the job closes, without re-approval.
begin;
\ir ../helpers/auth.sql
select plan(9);

create temp table t_ctx as select tests.tenant(tests.user('owner@n.test'), 'N') as tenant_n;
grant select on t_ctx to public;
select tests.member((select tenant_n from t_ctx), tests.user('staff@n.test'), '{staff}');
select tests.member((select tenant_n from t_ctx), tests.user('exec@n.test'), '{executive}');
update app.tenants set settings = jsonb_set(settings, '{allow_self_approval}', 'true');

select tests.login(tests.user('owner@n.test'));
insert into app.processes (code, name, step_type) values ('PRINT', 'พิมพ์', 'internal');
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
insert into app.job_steps (job_id, seq, process_id, step_type, planned_qty)
select (select id from t_job), 1, (select id from app.processes), 'internal', 100;
select api.submit_po_plan((select id from app.sales_orders));
create temp table t_ver as select version from app.job_steps;
grant select on t_ver to public;

reset role;
select tests.login(tests.user('staff@n.test'));
select lives_ok($$ select api.set_step_note((select id from app.job_steps), '  ใช้หมึกสีพิเศษ  ') $$, 'staff writes a note while the job awaits approval');
select is((select note from app.job_steps), 'ใช้หมึกสีพิเศษ', 'the note is trimmed and saved');
select is((select status::text from app.jobs), 'pending_approval', 'no re-approval is triggered');
select is((select version from app.job_steps), (select version from t_ver), 'the step version is unchanged');
select ok(exists (select 1 from app.job_activity_logs where action = 'step_note'), 'the change is on the job log');
select throws_ok($$ select api.set_step_note((select id from app.job_steps), repeat('x', 2001)) $$, 'P0001', 'step.note_too_long', 'notes are capped');
select lives_ok($$ select api.set_step_note((select id from app.job_steps), '') $$, 'an empty note clears it');
select is((select note from app.job_steps), null, 'the note is cleared');

reset role;
select tests.login(tests.user('exec@n.test'));
select throws_ok($$ select api.set_step_note((select id from app.job_steps), 'x') $$, 'P0001', 'auth.forbidden', 'an executive cannot write notes');

select * from finish();
rollback;
