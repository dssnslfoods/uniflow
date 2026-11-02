-- D-24 deliveries stop at good output; D-25 Staff sees no selling prices or dashboard.
begin;
\ir ../helpers/auth.sql
select plan(19);

create temp table t_ctx as select tests.tenant(tests.user('owner@s.test'), 'S') as tenant_s;
grant select on t_ctx to public;
select tests.member((select tenant_s from t_ctx), tests.user('sup@s.test'), '{supervisor}');
select tests.member((select tenant_s from t_ctx), tests.user('staff@s.test'), '{staff}');
select tests.member((select tenant_s from t_ctx), tests.user('exec@s.test'), '{executive}');
update app.tenants set settings = jsonb_set(settings, '{allow_self_approval}', 'true');

select tests.login(tests.user('owner@s.test'));
insert into app.processes (code, name, step_type) values ('PACK', 'แพ็ก', 'internal');
insert into app.machines (code, name, max_cap_per_hour, setup_min, efficiency_pct) values ('M1', 'M1', 6000, 0, 100);
insert into app.machine_processes (machine_id, process_id) select m.id, p.id from app.machines m cross join app.processes p;
insert into app.customers (code, name) values ('C1', 'ลูกค้า');
insert into app.sales_orders (customer_id, customer_po_no, po_date, due_date)
select id, 'PO-1', '2026-11-01', '2026-12-01' from app.customers;
insert into app.sales_order_items (sales_order_id, line_no, description, qty, uom, unit_price)
select id, 1, 'งาน', 100, 'ชิ้น', 7.5 from app.sales_orders;
select api.confirm_sales_order((select id from app.sales_orders));
create temp table t_job as
select api.create_job((select id from app.sales_orders), 'งาน', null,
  jsonb_build_array(jsonb_build_object('sales_order_item_id', (select id from app.sales_order_items), 'qty', 100))) as id;
grant select on t_job to public;
insert into app.job_steps (job_id, seq, process_id, step_type, machine_id, planned_qty)
select (select id from t_job), 1, (select id from app.processes), 'internal', (select id from app.machines), 100;
select api.submit_po_plan((select id from app.sales_orders));
select api.approve_po_plan((select id from app.sales_orders), null);
select api.release_jobs(array[(select id from t_job)]);
select api.start_step((select id from app.job_steps));
select api.complete_step((select id from app.job_steps), 90, 10, null);

reset role;
create function tests.ship(p_qty numeric) returns uuid language sql as $$
  select api.create_delivery((select id from app.sales_orders),
    jsonb_build_array(jsonb_build_object('job_id', (select id from t_job), 'qty', p_qty)))
$$;
grant execute on function tests.ship(numeric) to authenticated;
select tests.login(tests.user('owner@s.test'));

select is((select good_qty from api.job_good_qtys(array[(select id from t_job)])), 90.000, 'good output is 90 of 100');
-- Rework of the last step raises the good output
select api.add_rework_step((select id from app.job_steps where not is_rework), 5, 'ทำเพิ่ม', null);
select api.start_step((select id from app.job_steps where is_rework));
select api.complete_step((select id from app.job_steps where is_rework), 5, 0, null);
select is((select good_qty from api.job_good_qtys(array[(select id from t_job)])), 95.000, 'rework adds to good output');

select throws_ok($$ select api.close_job_short((select id from t_job), 'ไม่ทำเพิ่ม') $$, 'P0001', 'delivery.nothing_delivered', 'nothing shipped: cannot close short');
select throws_ok($$ select tests.ship(96) $$, 'P0001', 'delivery.over_good', 'cannot ship more than was made');
select lives_ok($$ select tests.ship(60) $$, 'part of the good pieces ships');
select throws_ok($$ select tests.ship(36) $$, 'P0001', 'delivery.over_good', 'the cap counts earlier deliveries');
select lives_ok($$ select tests.ship(35) $$, 'all good pieces shipped');
select is((select status::text from app.jobs), 'partially_delivered', 'a short job stays open');

reset role;
select tests.login(tests.user('sup@s.test'));
select throws_ok($$ select api.close_job_short((select id from t_job), 'ปิด') $$, 'P0001', 'auth.forbidden', 'a supervisor cannot close short');
reset role;
select tests.login(tests.user('owner@s.test'));
select throws_ok($$ select api.close_job_short((select id from t_job), ' ') $$, 'P0001', 'approval.reason_required', 'a reason is required');
select lives_ok($$ select api.close_job_short((select id from t_job), 'ลูกค้ารับเท่านี้') $$, 'a manager closes it short');
select is((select status::text from app.jobs), 'completed', 'the job is completed');
select is((select status::text from app.sales_orders), 'delivered', 'and its PO delivered');
select ok(exists (select 1 from app.job_activity_logs where action = 'closed_short' and detail ->> 'reason' = 'ลูกค้ารับเท่านี้'), 'the reason is on record');

-- Prices: Staff reads order lines but not what they sell for
reset role;
select tests.login(tests.user('staff@s.test'));
select is((select count(*)::int from app.sales_order_items), 1, 'staff still reads order lines');
select throws_ok($$ select unit_price from app.sales_order_items $$, '42501', 'permission denied for table sales_order_items', 'not the price column');
select is((select count(*)::int from app.sales_order_item_prices_v), 0, 'the price view is empty for staff');
select throws_ok($$ select api.dashboard_summary() $$, 'P0001', 'auth.forbidden', 'staff has no dashboard');
reset role;
select tests.login(tests.user('exec@s.test'));
select is((select unit_price from app.sales_order_item_prices_v), 7.5000, 'an executive reads prices through the view');

select * from finish();
rollback;
