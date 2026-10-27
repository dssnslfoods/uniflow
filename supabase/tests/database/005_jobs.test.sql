-- PO planning and approval (D-14…D-19, BR-R01/R02/R05/R11).
begin;
\ir ../helpers/auth.sql
select plan(32);

-- Step time formula (BR-R05 / G-10): 5,000 pcs, 8-up, 1 pass, 2% waste, 100 make-ready,
-- setup 30 min, 8,000 sheets/hr at 80% → 625 sheets → 737.5 → 30 + 737.5/6400×60 = 36.91
select is(app.estimate_step_minutes(5000, 8, 1, 30, 2, 100, 8000, 80), 36.91::numeric, 'step minutes formula');
select is(app.estimate_step_minutes(5000, 8, 4, 30, 0, 0, 8000, 100), 30 + 2500 / 8000.0 * 60, 'passes multiply sheets');

-- Fixtures ---------------------------------------------------------------------
create temp table t_ctx as select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'),   '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('mgr@a.test'),   '{manager}');
select tests.member((select tenant_a from t_ctx), tests.user('mgr2@a.test'),  '{manager,supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('staff@a.test'), '{staff}');

select tests.login(tests.user('owner@a.test'));
insert into app.processes (code, name, step_type) values
  ('PRINT', 'พิมพ์ออฟเซ็ท', 'internal'), ('CUT', 'ตัด', 'internal'),
  ('UV', 'เคลือบ UV', 'outsource'), ('PACK', 'แพ็ก', 'internal');
insert into app.machines (code, name, max_cap_per_hour, setup_min, efficiency_pct, makeready_waste_units)
values ('SM74', 'Heidelberg SM74', 8000, 30, 80, 100), ('CUT1', 'Polar 115', 20000, 10, 90, 0);
insert into app.machine_processes (machine_id, process_id)
select m.id, p.id from app.machines m, app.processes p
where (m.code, p.code) in (('SM74', 'PRINT'), ('CUT1', 'CUT'));
update app.processes set default_running_waste_pct = 2 where code = 'PRINT';
insert into app.customers (code, name) values ('C1', 'ABC');
insert into app.workflow_templates (name) values ('กล่อง');
insert into app.workflow_template_steps (template_id, seq, process_id, default_machine_id)
select t.id, x.seq, p.id, m.id
from app.workflow_templates t
cross join (values (1, 'PRINT', 'SM74'), (2, 'CUT', 'CUT1'), (3, 'UV', null), (3, 'PACK', null)) x(seq, pcode, mcode)
join app.processes p on p.code = x.pcode
left join app.machines m on m.code = x.mcode;

insert into app.sales_orders (customer_id, customer_po_no, due_date) select id, 'PO-1', current_date + 10 from app.customers;
insert into app.sales_order_items (sales_order_id, line_no, description, qty)
select id, 1, 'กล่อง A', 5000 from app.sales_orders union all
select id, 2, 'กล่อง B', 3000 from app.sales_orders;

create temp table t_so as select id from app.sales_orders;
create temp table t_items as select id, line_no, qty from app.sales_order_items;

-- A second PO whose line must never be matched to PO-1's jobs
insert into app.sales_orders (customer_id, customer_po_no, due_date) select id, 'PO-2', current_date + 20 from app.customers;
insert into app.sales_order_items (sales_order_id, line_no, description, qty)
select id, 1, 'อื่น', 10 from app.sales_orders where customer_po_no = 'PO-2';
grant select on t_so, t_items to public;

-- Draft PO cannot be planned
reset role;
select tests.login(tests.user('sup@a.test'));
select throws_ok($$ select api.create_job((select id from t_so), 'x') $$, 'P0001', 'job.order_not_confirmed', 'draft PO cannot get jobs');
select lives_ok($$ select api.confirm_sales_order((select id from t_so)) $$, 'PO confirmed');

-- Job from template, gang-running line 1 fully and line 2 partly (D-19)
create temp table t_job as
select api.create_job((select id from t_so), 'กล่อง A+B รอบแรก',
  (select id from app.workflow_templates where name = 'กล่อง'),
  jsonb_build_array(
    jsonb_build_object('sales_order_item_id', (select id from t_items where line_no = 1), 'qty', 5000),
    jsonb_build_object('sales_order_item_id', (select id from t_items where line_no = 2), 'qty', 1000))) as id;
grant select on t_job to public;

select is((select job_no from app.jobs where id = (select id from t_job)), 'JOB-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY') || '-0001', 'job number assigned');
select is((select qty from app.jobs where id = (select id from t_job)), 6000::numeric, 'job qty = matched qty');
select is((select count(*)::int from app.job_steps where job_id = (select id from t_job)), 4, 'template steps copied');
select is((select count(*)::int from app.job_steps where job_id = (select id from t_job) and seq = 3), 2, 'parallel stage kept (D-07)');
select is((select machine_id from app.job_steps s join app.processes p on p.id = s.process_id where p.code = 'PRINT'),
          (select id from app.machines where code = 'SM74'), 'default machine copied');
select ok((select est_minutes from app.job_steps s join app.processes p on p.id = s.process_id where p.code = 'PRINT') > 0,
          'step time estimated from machine');

-- Step-level n_up (D-02) recomputes time
update app.job_steps set n_up = 8 from app.processes p where p.id = job_steps.process_id and p.code = 'PRINT';
select is((select est_minutes from app.job_steps s join app.processes p on p.id = s.process_id where p.code = 'PRINT'),
          app.estimate_step_minutes(6000, 8, 1, 30, 2, 100, 8000, 80), 'n_up changes the estimate');

select throws_ok($$ update app.job_steps set machine_id = (select id from app.machines where code = 'CUT1')
                    where process_id = (select id from app.processes where code = 'PRINT') $$,
                 'P0001', 'step.machine_cannot_run_process', 'machine must support the process');

-- Coverage (BR-R11)
select is((select remaining_qty from app.sales_order_coverage_v where line_no = 2), 2000::numeric, 'line 2 has 2,000 unmatched');
select throws_ok($$ select api.submit_po_plan((select id from t_so)) $$, 'P0001', 'plan.coverage_incomplete', 'cannot submit with unmatched quantity');

select throws_ok($$ insert into app.job_order_items (job_id, sales_order_item_id, qty)
                    select (select id from t_job), id, 1 from app.sales_order_items
                    where sales_order_id <> (select id from t_so) limit 1 $$,
                 'P0001', 'job.item_not_in_order', 'cannot match a line from another PO');

create temp table t_job2 as
select api.create_job((select id from t_so), 'กล่อง B รอบสอง', null,
  jsonb_build_array(jsonb_build_object('sales_order_item_id', (select id from t_items where line_no = 2), 'qty', 2000))) as id;
grant select on t_job2 to public;
select throws_ok($$ select api.submit_po_plan((select id from t_so)) $$, 'P0001', 'plan.job_without_steps', 'every job needs a step (BR-R01)');

insert into app.job_steps (job_id, seq, process_id, step_type, planned_qty)
select (select id from t_job2), 1, id, 'internal', 2000 from app.processes where code = 'PACK';

select is(api.submit_po_plan((select id from t_so)), 2, 'supervisor submits the whole PO');
select is((select count(*)::int from app.jobs where status = 'pending_approval'), 2, 'both jobs pending approval');
select throws_ok($$ update app.jobs set title = 'x' where id = (select id from t_job) $$, 'P0001', 'job.not_planning', 'submitted job is locked');
select throws_ok($$ delete from app.job_steps where job_id = (select id from t_job) $$, 'P0001', 'job.not_planning', 'submitted steps are locked');
select throws_ok($$ select api.approve_po_plan((select id from t_so)) $$, 'P0001', 'auth.forbidden', 'supervisor cannot approve');

-- Manager rejects one job (D-18), approves the rest
reset role;
select tests.login(tests.user('mgr@a.test'));
select throws_ok($$ select api.reject_jobs(array[(select id from t_job2)], '') $$, 'P0001', 'approval.reason_required', 'reject needs a reason');
select is(api.reject_jobs(array[(select id from t_job2)], 'แพ็กต้องใช้กล่องลูกฟูก'), 1, 'manager rejects one job');
select is(api.approve_po_plan((select id from t_so)), 1, 'approve-all approves the remaining job');
select is((select status::text from app.jobs where id = (select id from t_job)), 'approved', 'job 1 approved');
select is((select status::text from app.sales_orders where id = (select id from t_so)), 'in_progress', 'PO moves to in progress');
select throws_ok($$ select api.reopen_sales_order((select id from t_so)) $$, 'P0001', 'order.has_jobs', 'PO with jobs cannot be reopened');

-- Segregation of duties (BR-R02, D-05)
reset role;
select tests.login(tests.user('mgr2@a.test'));
update app.job_steps set note = 'กล่องลูกฟูก' where job_id = (select id from t_job2);
select api.submit_po_plan((select id from t_so));
select throws_ok($$ select api.approve_po_plan((select id from t_so)) $$, 'P0001', 'approval.self_approval', 'cannot approve own submission');

reset role;
update app.tenants set settings = jsonb_set(settings, '{allow_self_approval}', 'true');
select tests.login(tests.user('mgr2@a.test'));
select is(api.approve_po_plan((select id from t_so)), 1, 'self-approval allowed when the tenant enables it');
reset role;
select ok((select self_approved from app.approvals where entity_id = (select id from t_job2) and action = 'approve'), 'self-approval is flagged');

select is((select count(*)::int from app.job_activity_logs where job_id = (select id from t_job2)), 5,
          'activity log: created, submitted, rejected, submitted, approved');

select tests.login(tests.user('staff@a.test'));
select throws_ok($$ select api.create_job((select id from t_so), 'x') $$, 'P0001', 'auth.forbidden', 'staff cannot create jobs');

select * from finish();
rollback;
