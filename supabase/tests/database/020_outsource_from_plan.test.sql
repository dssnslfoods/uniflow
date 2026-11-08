-- Outsourcing is decided on the plan: tick a step, pick a vendor, write a brief. Nowhere else.
begin;
\ir ../helpers/auth.sql
select plan(15);

create temp table t_ctx as select tests.tenant(tests.user('owner@o.test'), 'O') as tenant_o;
grant select on t_ctx to public;

select tests.login(tests.user('owner@o.test'));
select throws_ok($$ insert into app.processes (code, name, step_type) values ('X', 'x', 'outsource') $$,
                 '23514', null, 'a process can no longer be typed "outsource"');
insert into app.processes (code, name, step_type) values ('PRINT', 'พิมพ์', 'internal'), ('COAT', 'เคลือบ', 'internal'), ('SHIP', 'ส่ง', 'delivery');
insert into app.machines (code, name, max_cap_per_hour, setup_min, efficiency_pct, makeready_waste_units)
values ('M1', 'เครื่องเคลือบ', 5000, 10, 90, 0);
insert into app.machine_processes (machine_id, process_id)
select m.id, p.id from app.machines m, app.processes p where p.code = 'COAT';
insert into app.vendors (code, name) values ('V1', 'ร้านเคลือบ'), ('V2', 'ร้านเก่า');
update app.vendors set deleted_at = now() where code = 'V2';
insert into app.customers (code, name) values ('C1', 'ลูกค้า');
insert into app.sales_orders (customer_id, customer_po_no, po_date, due_date)
select id, 'PO-1', current_date, current_date + 20 from app.customers;
insert into app.sales_order_items (sales_order_id, line_no, description, qty, uom, unit_price)
select id, 1, 'งาน', 1000, 'ชิ้น', 1 from app.sales_orders;
select api.confirm_sales_order((select id from app.sales_orders));
create temp table t_job as
select api.create_job((select id from app.sales_orders), 'งาน', null,
  jsonb_build_array(jsonb_build_object('sales_order_item_id', (select id from app.sales_order_items), 'qty', 1000))) as id;
grant select on t_job to public;
insert into app.job_steps (job_id, seq, process_id, step_type, planned_qty)
select (select id from t_job), x.seq, p.id, 'internal', 1000
from (values (1, 'PRINT'), (2, 'COAT'), (4, 'SHIP')) x(seq, code) join app.processes p on p.code = x.code;
update app.job_steps set machine_id = (select id from app.machines) where process_id = (select id from app.processes where code = 'COAT');

reset role;
create function tests.coat() returns app.job_steps language sql as $$
  select s.* from app.job_steps s join app.processes p on p.id = s.process_id where p.code = 'COAT' $$;
grant execute on function tests.coat() to authenticated;
select tests.login(tests.user('owner@o.test'));

select throws_ok($$ update app.job_steps set outsourced = true where id = (tests.coat()).id $$,
                 'P0001', 'step.vendor_required', 'a ticked step needs a vendor');
select throws_ok($$ update app.job_steps set outsourced = true, vendor_id = (select id from app.vendors where code = 'V2')
                    where id = (tests.coat()).id $$,
                 'P0001', 'outsource.vendor_not_found', 'archived vendors cannot be picked');
select lives_ok($$ update app.job_steps set outsourced = true, vendor_id = (select id from app.vendors where code = 'V1'),
                   outsource_note = '  เคลือบ UV เงา ทั้งแผ่น  ' where id = (tests.coat()).id $$, 'tick, vendor and brief saved');
select is((tests.coat()).step_type::text, 'outsource', 'the step becomes an outsource step');
select is((tests.coat()).machine_id, null, 'an outsourced step leaves its machine');
select is((tests.coat()).outsource_note, 'เคลือบ UV เงา ทั้งแผ่น', 'the brief is trimmed');

select lives_ok($$ update app.job_steps set outsourced = false where id = (tests.coat()).id $$, 'untick');
select is((tests.coat()).step_type::text, 'internal', 'unticked step goes back to the process type');
select is((tests.coat()).vendor_id, null, 'unticking drops the vendor');

select throws_ok($$ insert into app.job_steps (job_id, seq, process_id, step_type, planned_qty, outsourced, vendor_id)
                    select (select id from t_job), 3, (select id from app.processes where code = 'SHIP'), 'delivery', 1000, true,
                           (select id from app.vendors where code = 'V1') $$,
                 'P0001', 'step.cannot_outsource', 'delivery is never outsourced');

update app.job_steps set outsourced = true, vendor_id = (select id from app.vendors where code = 'V1'), outsource_note = 'เคลือบ UV'
where id = (tests.coat()).id;
reset role;
update app.tenants set settings = jsonb_set(settings, '{allow_self_approval}', 'true');
select tests.login(tests.user('owner@o.test'));
select api.submit_po_plan((select id from app.sales_orders));
select api.approve_po_plan((select id from app.sales_orders));
select api.release_jobs(array[(select id from t_job)]);
select api.start_step((select s.id from app.job_steps s join app.processes p on p.id = s.process_id where p.code = 'PRINT' and s.seq = 1));
select api.complete_step((select s.id from app.job_steps s join app.processes p on p.id = s.process_id where p.code = 'PRINT' and s.seq = 1), 1000, 0);

create temp table t_os as select api.send_outsource((tests.coat()).id, 1000, now() + interval '2 days') as id;
grant select on t_os to public;
select is((select vendor_id from app.outsource_orders where id = (select id from t_os)), (select id from app.vendors where code = 'V1'),
          'the order goes to the vendor chosen on the plan');
select is((select note from app.outsource_orders where id = (select id from t_os)), 'เคลือบ UV', 'the plan brief travels with the order');

-- A flow edit can move a not-yet-sent step outside, carrying vendor and brief.
select api.receive_outsource((select id from t_os), 1000);
select api.qc_outsource((select id from t_os), true);
select throws_ok(format($$ select api.edit_workflow(%L, %L::jsonb) $$, (select id from t_job), (
  select jsonb_agg(jsonb_build_object('id', id, 'seq', seq, 'process_id', process_id, 'machine_id', machine_id,
                                      'planned_qty', planned_qty, 'outsourced', false) order by seq)
  from app.job_steps where job_id = (select id from t_job))),
  'P0001', 'workflow.locked_step_changed', 'a finished outsourced step cannot be taken back in');

-- Demo data: coating comes ticked to the demo vendor.
reset role;
select app.seed_demo(tests.tenant(tests.user('demo@o.test'), 'D'), tests.user('demo@o.test'));
select ok((select bool_and(s.outsourced and v.code = 'V-UV' and s.step_type = 'outsource')
           from app.job_steps s join app.processes p on p.id = s.process_id join app.vendors v on v.id = s.vendor_id
           where p.code = 'COAT' and p.tenant_id <> (select tenant_o from t_ctx)), 'demo coating steps are outsourced to ยูวีทอง');

select * from finish();
rollback;
