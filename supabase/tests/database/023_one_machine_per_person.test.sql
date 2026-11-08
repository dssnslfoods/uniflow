-- One person, one machine: api.assign_operator moves people and keeps the history clean.
begin;
\ir ../helpers/auth.sql
select plan(12);

create temp table t_ctx as
select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a,
       tests.tenant(tests.user('owner@b.test'), 'B') as tenant_b;
grant select on t_ctx to public;
select app.seed_demo((select tenant_a from t_ctx), tests.user('owner@a.test'));
select app.seed_demo((select tenant_b from t_ctx), tests.user('owner@b.test'));

create temp table t_m as
select tests.member((select tenant_a from t_ctx), tests.user('mgr@a.test'), '{manager}') as mgr,
       tests.member((select tenant_a from t_ctx), tests.user('op@a.test'), '{staff}') as op,
       (select id from app.machines where code = 'SM74' and tenant_id = (select tenant_a from t_ctx)) as sm74,
       (select id from app.machines where code = 'CUT01' and tenant_id = (select tenant_a from t_ctx)) as cut01,
       (select id from app.machines where code = 'SM74' and tenant_id = (select tenant_b from t_ctx)) as sm74_b;
grant select on t_m to public;

select tests.login(tests.user('op@a.test'));
select throws_ok($$ select api.assign_operator((select op from t_m), (select sm74 from t_m)) $$, 'P0001', 'auth.forbidden', 'staff cannot assign');

reset role;
select tests.login(tests.user('mgr@a.test'));
select lives_ok($$ select api.assign_operator((select op from t_m), (select sm74 from t_m)) $$, 'manager puts op on SM74');
select lives_ok($$ select api.assign_operator((select op from t_m), (select cut01 from t_m)) $$, 'then onto CUT01');
select is((select array_agg(machine_id) from app.machine_operators where membership_id = (select op from t_m)),
          array[(select cut01 from t_m)], 'the move leaves op on CUT01 only');
select is((select count(*)::int from app.machine_assignments where membership_id = (select op from t_m) and valid_to is null), 1,
          'one open period');
select ok((select valid_to is not null from app.machine_assignments
           where membership_id = (select op from t_m) and machine_id = (select sm74 from t_m)), 'the SM74 period is closed');
select lives_ok($$ select api.assign_operator((select op from t_m), (select cut01 from t_m)) $$, 'same machine again is a no-op');
select is((select count(*)::int from app.machine_assignments where membership_id = (select op from t_m)), 2, 'and adds no history');
select throws_ok($$ insert into app.machine_operators (machine_id, membership_id) select sm74, op from t_m $$,
                 '23505', null, 'a direct second machine is refused');
select throws_ok($$ select api.assign_operator((select op from t_m), (select sm74_b from t_m)) $$,
                 'P0001', 'machine.not_found', 'another shop''s machine is refused');
select lives_ok($$ select api.assign_operator((select op from t_m), null) $$, 'null takes op off');
select is((select count(*)::int from app.machine_assignments where membership_id = (select op from t_m) and valid_to is null), 0,
          'no open period left');

select * from finish();
rollback;
