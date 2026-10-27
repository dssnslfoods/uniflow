-- RBAC on master data (SRS §10 + G-23) and soft-delete rule (BR-R08).
begin;
\ir ../helpers/auth.sql
select plan(14);

create temp table t_ctx as select tests.tenant(tests.user('admin@a.test'), 'A', 'trial') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('mgr@a.test'),   '{manager}');
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'),   '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('staff@a.test'), '{staff}');

-- Admin sets up a machine with cost
select tests.login(tests.user('admin@a.test'));
insert into app.machines (code, name, max_cap_per_hour) values ('SM74', 'Heidelberg SM74', 8000);
insert into app.machine_costs (machine_id, cost_per_hour) select id, 1200 from app.machines;

select throws_ok($$ delete from app.machines $$, '42501', null, 'machines cannot be hard-deleted (BR-R08)');
select lives_ok($$ update app.machines set deleted_at = now(), status = 'inactive' where code = 'SM74';
                   update app.machines set deleted_at = null, status = 'active' where code = 'SM74' $$,
                'machines are soft-deleted');

-- Plan limit on machines (trial = 5)
select lives_ok($$ insert into app.machines (code, name, max_cap_per_hour)
                   select 'M' || g, 'Machine ' || g, 1000 from generate_series(1, 4) g $$, 'trial plan allows 5 machines');
select throws_ok($$ insert into app.machines (code, name, max_cap_per_hour) values ('M9', 'one too many', 1000) $$,
                 'P0001', 'Plan limit reached: 5 machines', 'trial plan blocks the 6th machine');

-- Manager: edits master data and sees cost
reset role;
select tests.login(tests.user('mgr@a.test'));
select lives_ok($$ update app.machines set efficiency_pct = 80 where code = 'SM74' $$, 'manager updates machine specs');
select is((select count(*)::int from app.machine_costs), 1, 'manager sees machine cost');

-- Supervisor: reads machines, no cost, can set maintenance, designs templates
reset role;
select tests.login(tests.user('sup@a.test'));
select is((select count(*)::int from app.machines), 5, 'supervisor reads machines');
select is((select count(*)::int from app.machine_costs), 0, 'supervisor does not see machine cost');
select throws_ok($$ insert into app.machines (code, name, max_cap_per_hour) values ('X', 'x', 1) $$,
                 '42501', null, 'supervisor cannot create machines');
select lives_ok($$ select api.set_machine_status((select id from app.machines where code = 'SM74'), 'maintenance') $$,
                'supervisor can put a machine into maintenance (G-23)');
select lives_ok($$ insert into app.workflow_templates (name) values ('กล่องบรรจุภัณฑ์') $$,
                'supervisor creates workflow templates (D-16)');

-- Staff: read-only on masters
reset role;
select tests.login(tests.user('staff@a.test'));
select is((select status::text from app.machines where code = 'SM74'), 'maintenance', 'staff sees machine status');
select throws_ok($$ insert into app.customers (code, name) values ('C1', 'x') $$, '42501', null, 'staff cannot create customers');
select throws_ok($$ select api.set_machine_status((select id from app.machines where code = 'SM74'), 'active') $$,
                 'P0001', 'auth.forbidden', 'staff cannot change machine status');

select * from finish();
rollback;
