-- Demo seed: realistic data at every stage, through the real api.* rules; safe to re-run.
begin;
\ir ../helpers/auth.sql
select plan(14);

create temp table t_ctx as
select tests.tenant(tests.user('owner@demo.test'), 'Demo Shop', 'trial') as tenant_a,
       tests.tenant(tests.user('other@x.test'), 'Other Shop', 'trial') as tenant_b;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('sup@demo.test'), '{supervisor}');
insert into app.platform_admins (user_id) values (tests.user('root@uniflow.test'));

select tests.login(tests.user('sup@demo.test'));
select throws_ok($$ select api.seed_demo() $$, 'P0001', 'auth.forbidden', 'only a shop admin can load demo data');

reset role;
select tests.login(tests.user('owner@demo.test'));
select throws_ok(format($$ select api.seed_demo(%L) $$, (select tenant_b from t_ctx)), 'P0001', 'auth.forbidden', 'shop admin cannot seed another shop');
select is((api.seed_demo() ->> 'orders')::int, 6, 'six demo POs');
select is(app.tenant_id(), (select tenant_a from t_ctx), 'caller claims restored after seeding');

select is((select count(*)::int from app.machines), 5, 'five machines (fits the trial plan)');
select is((select count(*)::int from app.sales_orders where status = 'draft'), 1, 'one draft PO');
select is((select count(*)::int from app.sales_orders where status = 'confirmed'), 2, 'confirmed POs: one unplanned, one awaiting approval');
select is((select count(*)::int from app.jobs where status = 'pending_approval'), 2, 'two jobs waiting for approval');
select is((select count(*)::int from app.jobs where status = 'in_production'), 4, 'four jobs on the board');
select ok((select bool_and(planned_start is not null) from app.job_steps s join app.jobs j on j.id = s.job_id where j.status = 'in_production'),
          'released steps are scheduled');
select is((select (settings ->> 'allow_self_approval')::boolean from app.tenants where id = (select tenant_a from t_ctx)), false,
          'self-approval setting restored');
select is((api.seed_demo() ->> 'skipped')::boolean, true, 'second run is skipped');

reset role;
select tests.login(tests.user('root@uniflow.test'));
select is((api.seed_demo((select tenant_b from t_ctx)) ->> 'orders')::int, 6, 'platform admin seeds any shop');
reset role;
select is((select count(*)::int from app.sales_orders where tenant_id = (select tenant_b from t_ctx)), 6, 'data lands in the target shop');

select * from finish();
rollback;
