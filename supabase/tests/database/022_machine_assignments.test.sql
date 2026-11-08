-- Staff assigned to machines from the board: dated history, role rules, and the staffing report.
begin;
\ir ../helpers/auth.sql
select plan(25);

create temp table t_ctx as
select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a,
       tests.tenant(tests.user('owner@b.test'), 'B') as tenant_b;
grant select on t_ctx to public;
select app.seed_demo((select tenant_a from t_ctx), tests.user('owner@a.test'));

create temp table t_m as
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'), '{supervisor}') as sup,
       tests.member((select tenant_a from t_ctx), tests.user('mgr@a.test'), '{manager}') as mgr,
       tests.member((select tenant_a from t_ctx), tests.user('exec@a.test'), '{executive}') as exec,
       tests.member((select tenant_a from t_ctx), tests.user('op1@a.test'), '{staff}') as op1,
       tests.member((select tenant_a from t_ctx), tests.user('op2@a.test'), '{staff}') as op2,
       tests.member((select tenant_b from t_ctx), tests.user('sup@b.test'), '{supervisor}') as sup_b,
       tests.user('sup@a.test') as sup_u,
       (select id from app.machines where code = 'SM74' and tenant_id = (select tenant_a from t_ctx)) as sm74,
       (select id from app.machines where code = 'CUT01' and tenant_id = (select tenant_a from t_ctx)) as cut01;
grant select on t_m to public;

-- Who may assign -------------------------------------------------------------------------
select tests.login(tests.user('op1@a.test'));
select throws_ok($$ insert into app.machine_operators (machine_id, membership_id) select sm74, op1 from t_m $$,
                 '42501', null, 'staff cannot assign people to machines');
select is((select count(*)::int from app.machine_assignments), 0, 'staff cannot read assignment history');
select throws_ok($$ select api.staffing_report(current_date - 7, current_date) $$, 'P0001', 'auth.forbidden', 'staff cannot open the staffing report');

reset role;
select tests.login(tests.user('sup@a.test'));
select lives_ok($$ insert into app.machine_operators (machine_id, membership_id) select sm74, op1 from t_m $$, 'supervisor assigns op1 to SM74');
select throws_ok($$ insert into app.machine_operators (machine_id, membership_id) select cut01, op1 from t_m $$,
                 '23505', null, 'one person looks after one machine at a time');
select lives_ok($$ insert into app.machine_operators (machine_id, membership_id) select sm74, op2 from t_m $$, 'one machine may have several people');
select is((select count(*)::int from app.machine_assignments where valid_to is null), 2, 'each assignment opens a dated period');
select is((select assigned_by from app.machine_assignments
           where machine_id = (select sm74 from t_m) and membership_id = (select op1 from t_m)),
          (select sup_u from t_m), 'the history records who assigned');

select lives_ok($$ delete from app.machine_operators where machine_id = (select sm74 from t_m) and membership_id = (select op2 from t_m) $$,
                'supervisor takes op2 off SM74');
select ok((select valid_to is not null and ended_by = (select sup_u from t_m) from app.machine_assignments
           where machine_id = (select sm74 from t_m) and membership_id = (select op2 from t_m)),
          'removal closes the period and records who did it');
select lives_ok($$ insert into app.machine_operators (machine_id, membership_id) select sm74, op2 from t_m $$, 'op2 back on SM74');
select is((select count(*)::int from app.machine_assignments
           where machine_id = (select sm74 from t_m) and membership_id = (select op2 from t_m)), 2, 're-assigning starts a new period');

reset role;
select tests.login(tests.user('sup@b.test'));
select is((select count(*)::int from app.machine_assignments), 0, 'another shop sees none of it');
select throws_ok($$ insert into app.machine_operators (machine_id, membership_id) select sm74, sup_b from t_m $$,
                 '23503', null, 'another shop cannot assign to these machines');

-- Deactivation and removal ----------------------------------------------------------------
reset role;
update app.memberships set is_active = false where id = (select op2 from t_m);
select is((select count(*)::int from app.machine_operators where membership_id = (select op2 from t_m)), 0, 'a deactivated member leaves their machines');
select is((select count(*)::int from app.machine_assignments where membership_id = (select op2 from t_m) and valid_to is null), 0,
          'and their periods are closed');
delete from app.memberships where id = (select op2 from t_m);
select is((select count(*)::int from app.machine_assignments where profile_id = tests.user('op2@a.test')), 2,
          'history outlives the membership');

-- Staffing report -------------------------------------------------------------------------
-- Monday 3 Mar 2025, default calendar 08–12 & 13–17 (Asia/Bangkok).
-- SM74 runs 16:00–18:00 with op1 and sup assigned → 120 min run, 60 min OT, split two ways.
-- CUT01 runs 09:00–10:00 with nobody assigned that day → unstaffed.
insert into app.machine_assignments (tenant_id, machine_id, profile_id, membership_id, valid_from, valid_to)
select (select tenant_a from t_ctx), (select sm74 from t_m), u, m, '2025-03-01 00:00+07', '2025-03-10 00:00+07'
from (values (tests.user('op1@a.test'), (select op1 from t_m)), (tests.user('sup@a.test'), (select sup from t_m))) v(u, m);
create temp table t_step as select s.id from app.job_steps s join app.jobs j on j.id = s.job_id
  where j.tenant_id = (select tenant_a from t_ctx) and s.status = 'pending' limit 1;
insert into app.production_logs (tenant_id, job_step_id, action, machine_id, created_at) values
  ((select tenant_a from t_ctx), (select id from t_step), 'start',    (select sm74 from t_m),  '2025-03-03 16:00+07'),
  ((select tenant_a from t_ctx), (select id from t_step), 'complete', (select sm74 from t_m),  '2025-03-03 18:00+07');
insert into app.production_logs (tenant_id, job_step_id, action, machine_id, created_at)
select (select tenant_a from t_ctx), s.id, a, (select cut01 from t_m), t::timestamptz
from (select s.id from app.job_steps s join app.jobs j on j.id = s.job_id
      where j.tenant_id = (select tenant_a from t_ctx) and s.id <> (select id from t_step) limit 1) s
cross join (values ('start'::app.step_action, '2025-03-03 09:00+07'), ('pause', '2025-03-03 10:00+07')) v(a, t);

select tests.login(tests.user('exec@a.test'));
create temp table t_r as select api.staffing_report('2025-03-03', '2025-03-03') as r;
create temp view t_mach as select x from t_r, jsonb_array_elements(r -> 'machines') x;
create temp view t_ppl as select x from t_r, jsonb_array_elements(r -> 'people') x;

select is((select (x ->> 'run_min')::int from t_mach where x ->> 'name' = 'Heidelberg SM74'), 120, 'machine run time from floor logs');
select is((select (x ->> 'ot_min')::int from t_mach where x ->> 'name' = 'Heidelberg SM74'), 60, 'running after 17:00 is overtime');
select is((select (x ->> 'avail_min')::int from t_mach where x ->> 'name' = 'Heidelberg SM74'), 480, 'a Monday offers 480 shift minutes');
select is((select (x ->> 'unstaffed_min')::int from t_mach where x ->> 'name' = 'Polar 115'), 60, 'run time with nobody assigned is unstaffed');
select is((select (x ->> 'run_min')::int from t_ppl where x ->> 'name' = 'op1'), 60, 'two people share the run time evenly');
select is((select (x ->> 'ot_min')::int from t_ppl where x ->> 'name' = 'op1'), 30, 'and the overtime');
select is((select (x ->> 'shift_min')::int from t_ppl where x ->> 'name' = 'op1'), 480, 'a person''s shift hours come from their machine''s calendar');

select throws_ok($$ select api.staffing_report('2025-03-05', '2025-03-01') $$, 'P0001', 'report.bad_period', 'the period must run forwards');

select * from finish();
rollback;
