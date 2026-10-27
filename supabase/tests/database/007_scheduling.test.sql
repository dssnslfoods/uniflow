-- Release, readiness, scheduling and board moves (G-01, G-05, BR-R06, BR-R08, FR-6.2/6.3).
begin;
\ir ../helpers/auth.sql
select plan(29);

-- plpgsql so the body (which reads t_steps, created later) is not validated now
create function tests.step(p_line int, p_code text) returns app.job_steps language plpgsql as $$
declare r app.job_steps;
begin
  select s.* into r from app.job_steps s where s.id = (select id from t_steps where line_no = p_line and code = p_code);
  return r;
end $$;
grant execute on function tests.step(int, text) to authenticated;

create temp table t_ctx as select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'),   '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('staff@a.test'), '{staff}');
update app.tenants set settings = jsonb_set(settings, '{allow_self_approval}', 'true');

create temp table t_cal as select app.default_calendar((select tenant_a from t_ctx)) as id;
grant select on t_cal to public;

-- Calendar maths: default calendar = Mon–Sat 08–12, 13–17 Asia/Bangkok. 2026-11-02 is a Monday.
select is((select start_at from app.schedule_window((select id from t_cal), 'Asia/Bangkok', '2026-11-02 08:00+07', 120)),
          '2026-11-02 08:00+07'::timestamptz, 'starts at shift start');
select is((select end_at from app.schedule_window((select id from t_cal), 'Asia/Bangkok', '2026-11-02 08:00+07', 120)),
          '2026-11-02 10:00+07'::timestamptz, '2 hours inside the morning shift');
select is((select end_at from app.schedule_window((select id from t_cal), 'Asia/Bangkok', '2026-11-02 11:00+07', 120)),
          '2026-11-02 14:00+07'::timestamptz, 'skips the lunch break');
select is((select end_at from app.schedule_window((select id from t_cal), 'Asia/Bangkok', '2026-11-07 16:00+07', 120)),
          '2026-11-09 09:00+07'::timestamptz, 'Saturday afternoon rolls over Sunday to Monday');
select is((select start_at from app.schedule_window((select id from t_cal), 'Asia/Bangkok', '2026-11-02 06:00+07', 0)),
          '2026-11-02 08:00+07'::timestamptz, 'before hours waits for the shift');
insert into app.holidays (tenant_id, day, name) values ((select tenant_a from t_ctx), '2026-11-03', 'วันหยุด');
select is((select end_at from app.schedule_window((select id from t_cal), 'Asia/Bangkok', '2026-11-02 16:00+07', 120)),
          '2026-11-04 09:00+07'::timestamptz, 'skips holidays');
select is(app.available_minutes((select id from t_cal), '2026-11-02'), 480::numeric, '480 working minutes on Monday');
select is(app.available_minutes((select id from t_cal), '2026-11-08'), 0::numeric, 'no working minutes on Sunday');

-- Fixtures: two approved jobs, each PRINT (SM74) → CUT (CUT1) ------------------
select tests.login(tests.user('owner@a.test'));
insert into app.processes (code, name, step_type) values ('PRINT', 'พิมพ์', 'internal'), ('CUT', 'ตัด', 'internal');
insert into app.machines (code, name, max_cap_per_hour, setup_min, efficiency_pct)
values ('SM74', 'SM74', 6000, 30, 100), ('CUT1', 'Polar', 20000, 10, 100), ('SM52', 'SM52', 4000, 20, 100);
insert into app.machine_processes (machine_id, process_id)
select m.id, p.id from app.machines m, app.processes p
where (m.code, p.code) in (('SM74', 'PRINT'), ('SM52', 'PRINT'), ('CUT1', 'CUT'));
insert into app.customers (code, name) values ('C1', 'ABC');
insert into app.sales_orders (customer_id, customer_po_no, due_date) select id, 'PO-1', current_date + 30 from app.customers;
insert into app.sales_order_items (sales_order_id, line_no, description, qty)
select id, 1, 'A', 6000 from app.sales_orders union all select id, 2, 'B', 6000 from app.sales_orders;
select api.confirm_sales_order(id) from app.sales_orders;

create temp table t_jobs as
select i.line_no, api.create_job(i.sales_order_id, 'Job ' || i.line_no, null,
  jsonb_build_array(jsonb_build_object('sales_order_item_id', i.id, 'qty', 6000))) as id
from app.sales_order_items i order by i.line_no;
grant select on t_jobs to public;

insert into app.job_steps (job_id, seq, process_id, step_type, machine_id, planned_qty)
select j.id, x.seq, p.id, 'internal', m.id, 6000
from t_jobs j
cross join (values (1, 'PRINT', 'SM74'), (2, 'CUT', 'CUT1')) x(seq, pcode, mcode)
join app.processes p on p.code = x.pcode
join app.machines m on m.code = x.mcode;

create temp table t_steps as
select j.line_no, p.code, s.id from app.job_steps s join t_jobs j on j.id = s.job_id join app.processes p on p.id = s.process_id;
grant select on t_steps to public;

select throws_ok($$ select api.release_jobs(array(select id from t_jobs)) $$, 'P0001', 'release.nothing_approved', 'planning jobs cannot be released');
select api.submit_po_plan(id) from app.sales_orders;
select api.approve_po_plan(id) from app.sales_orders;

-- Release ------------------------------------------------------------------------
reset role;
select tests.login(tests.user('staff@a.test'));
select throws_ok($$ select api.release_jobs(array(select id from t_jobs)) $$, 'P0001', 'auth.forbidden', 'staff cannot release');

reset role;
select tests.login(tests.user('sup@a.test'));
select is(api.release_jobs(array(select id from t_jobs)), 2, 'supervisor releases both jobs');
select is((select count(*)::int from app.jobs where status = 'in_production'), 2, 'jobs are in production');
select is((select status::text from app.job_steps where id = (select id from t_steps where line_no = 1 and code = 'PRINT')), 'ready', 'first stage is ready');
select is((select status::text from app.job_steps where id = (select id from t_steps where line_no = 1 and code = 'CUT')), 'pending', 'later stage waits');
select is((select array_agg(queue_position order by queue_position) from app.job_steps s join app.machines m on m.id = s.machine_id where m.code = 'SM74'),
          '{1,2}'::int[], 'steps queued on the machine in order');

-- Scheduling ---------------------------------------------------------------------
select ok((select bool_and(planned_start is not null and planned_end is not null) from app.job_steps), 'every step is scheduled');
select ok((tests.step(1, 'CUT')).planned_start >= (tests.step(1, 'PRINT')).planned_end, 'cut waits for its print (stage order)');
select ok((tests.step(2, 'PRINT')).planned_start >= (tests.step(1, 'PRINT')).planned_end, 'second print waits for the machine');
select ok((select planned_finish_at from app.jobs where id = (select id from t_jobs where line_no = 2))
          >= (tests.step(2, 'CUT')).planned_end, 'job finish = last step end');

-- Moves ------------------------------------------------------------------------------
create temp table t_move as
select api.move_step((tests.step(2, 'PRINT')).id, (select id from app.machines where code = 'SM74'),
                     (tests.step(1, 'PRINT')).id, (tests.step(2, 'PRINT')).version) as result;
grant select on t_move to public;
select ok((tests.step(2, 'PRINT')).planned_start < (tests.step(1, 'PRINT')).planned_start, 'moving before reorders the queue');
select ok((select result ? 'load_pct' from t_move), 'move returns load warning data');

select throws_ok(format($$ select api.move_step(%L, (select id from app.machines where code = 'SM74'), null, 1) $$, (tests.step(2, 'PRINT')).id),
                 'P0001', 'step.conflict', 'stale version is rejected');
select throws_ok(format($$ select api.move_step(%L, (select id from app.machines where code = 'CUT1'), null, %s) $$,
                        (tests.step(1, 'PRINT')).id, (tests.step(1, 'PRINT')).version),
                 'P0001', 'step.machine_cannot_run_process', 'machine must support the process');

select lives_ok(format($$ select api.move_step(%L, (select id from app.machines where code = 'SM52'), null, %s) $$,
                       (tests.step(1, 'PRINT')).id, (tests.step(1, 'PRINT')).version), 'move to another capable machine');
select ok((tests.step(1, 'PRINT')).est_minutes > (select est_minutes from app.job_steps where id = (tests.step(2, 'PRINT')).id),
          'slower machine re-estimates time');

reset role;
select tests.login(tests.user('sup@a.test'));
select api.set_machine_status(id, 'maintenance') from app.machines where code = 'SM74';
select throws_ok(format($$ select api.move_step(%L, (select id from app.machines where code = 'SM74'), null, %s) $$,
                        (tests.step(1, 'PRINT')).id, (tests.step(1, 'PRINT')).version),
                 'P0001', 'step.machine_unavailable', 'machine in maintenance takes no new work (BR-R08)');

-- Risk + bookkeeping ------------------------------------------------------------------
reset role;
select set_config('app.in_command', 'on', true);
update app.jobs set due_date = current_date - 1 where id = (select id from t_jobs where line_no = 1);
select set_config('app.in_command', 'off', true);
select tests.login(tests.user('sup@a.test'));
select api.reschedule();
select ok((select is_at_risk from app.jobs where id = (select id from t_jobs where line_no = 1)), 'job past its due date is at risk');
select is((select count(*)::int from api.machine_load(current_date, 7)), 21, 'load rows = 3 machines × 7 days');

reset role;
select is_empty($$ select 1 from audit.logs where table_name = 'job_steps' and operation = 'UPDATE' and diff ? 'planned_start' $$,
                'scheduler updates stay out of the audit log');

select * from finish();
rollback;
