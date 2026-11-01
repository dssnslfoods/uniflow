-- Regressions found in the full-system UAT (1 Nov 2026).
begin;
\ir ../helpers/auth.sql
select plan(13);

create temp table t_ctx as
select tests.tenant(tests.user('owner@u.test'), 'U', 'trial') as tenant_u,
       tests.user('plain@u.test') as plain,
       tests.user('root@u.test') as root;
grant select on t_ctx to public;
select tests.member((select tenant_u from t_ctx), tests.user('sup@u.test'), '{supervisor}');
insert into app.platform_admins (user_id) values ((select root from t_ctx));

-- Archiving a machine: blocked while released work is queued, allowed once it is gone ------
select tests.login(tests.user('owner@u.test'));
insert into app.processes (code, name, step_type) values ('PRINT', 'พิมพ์', 'internal');
insert into app.machines (code, name, max_cap_per_hour, setup_min, efficiency_pct) values ('M1', 'M1', 6000, 30, 100), ('M2', 'M2', 6000, 30, 100);
insert into app.machine_processes (machine_id, process_id)
select m.id, p.id from app.machines m cross join app.processes p;
insert into app.customers (code, name) values ('C1', 'ลูกค้า');
insert into app.sales_orders (customer_id, customer_po_no, po_date, due_date)
select id, 'PO-1', '2026-11-01', '2026-12-01' from app.customers;
insert into app.sales_order_items (sales_order_id, line_no, description, qty, uom)
select id, 1, 'งาน', 100, 'ชิ้น' from app.sales_orders;
select api.confirm_sales_order((select id from app.sales_orders));
create temp table t_job as
select api.create_job((select id from app.sales_orders), 'งาน', null,
  jsonb_build_array(jsonb_build_object('sales_order_item_id', (select id from app.sales_order_items), 'qty', 100))) as id;
grant select on t_job to public;
insert into app.job_steps (job_id, seq, process_id, step_type, machine_id, planned_qty)
select (select id from t_job), 1, (select id from app.processes), 'internal', (select id from app.machines where code = 'M1'), 100;

select lives_ok($$ update app.machines set deleted_at = now() where code = 'M2' $$, 'an idle machine can be archived');
select lives_ok($$ update app.machines set deleted_at = null where code = 'M2' $$, 'and restored');
select lives_ok($$ update app.machines set deleted_at = now() where code = 'M1' $$, 'a machine only planned on can be archived');
select lives_ok($$ update app.machines set deleted_at = null where code = 'M1' $$, 'and restored');

reset role;
update app.tenants set settings = jsonb_set(settings, '{allow_self_approval}', 'true');
select tests.login(tests.user('sup@u.test'));
select api.submit_po_plan((select id from app.sales_orders));
reset role;
select tests.login(tests.user('owner@u.test'));
select api.approve_po_plan((select id from app.sales_orders), null);
select throws_ok($$ update app.machines set deleted_at = now() where code = 'M1' $$, 'P0001', 'machine.has_queue', 'a machine with queued work cannot be archived');
select api.cancel_job((select id from t_job), 'ลูกค้ายกเลิก');
select lives_ok($$ update app.machines set deleted_at = now() where code = 'M1' $$, 'cancelled work no longer blocks it');

-- Invitations: the seat is checked before anything is sent ---------------------------------
select lives_ok($$ select api.assert_can_invite('new@u.test') $$, 'a free seat passes');
reset role;
select tests.member((select tenant_u from t_ctx), tests.user('m3@u.test'), '{staff}');
select tests.member((select tenant_u from t_ctx), tests.user('m4@u.test'), '{staff}');
select tests.member((select tenant_u from t_ctx), tests.user('m5@u.test'), '{staff}');
select tests.login(tests.user('owner@u.test'));
select throws_ok($$ select api.assert_can_invite('new@u.test') $$, 'P0001', 'Plan limit reached: 5 users', 'a full plan is refused before the email');
select lives_ok($$ select api.assert_can_invite('M5@u.test') $$, 'an existing member needs no new seat');
reset role;
select tests.login(tests.user('sup@u.test'));
select throws_ok($$ select api.assert_can_invite('new@u.test') $$, 'P0001', 'auth.forbidden', 'only an admin may check');
reset role;
select tests.login((select plain from t_ctx));
select throws_ok(format($$ select api.assert_can_invite('new@u.test', %L) $$, (select tenant_u from t_ctx)), 'P0001', 'auth.forbidden', 'the console form needs a platform admin');

-- Suspended shops: visible to their people, and no way around it through onboarding --------
reset role;
update app.tenants set status = 'suspended' where id = (select tenant_u from t_ctx);
select tests.login(tests.user('owner@u.test'));
select is((select name from api.my_suspended_tenants()), 'U', 'the suspended shop is listed');
select throws_ok($$ select api.create_tenant('ร้านใหม่') $$, 'P0001', 'tenant.suspended', 'a suspended shop owner cannot open a new trial');

select * from finish();
rollback;
