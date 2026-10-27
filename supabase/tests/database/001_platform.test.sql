begin;
\ir ../helpers/auth.sql
select plan(22);

-- Onboarding ------------------------------------------------------------------
select tests.login(tests.user('owner@a.test'));

select is((select count(*)::int from api.my_tenants()), 0, 'new user has no tenant');
select is(app.tenant_id(), null::uuid, 'JWT has no tenant before onboarding');
select throws_ok($$ select api.create_tenant('  ') $$, 'P0001', 'tenant.name_required', 'tenant name is required');

create temp table t_ctx as select api.create_tenant('โรงพิมพ์ A') as tenant_a;
grant select on t_ctx to public;

reset role;
select tests.login(tests.user('owner@a.test'));   -- token refresh picks up the new tenant

select is(app.tenant_id(), (select tenant_a from t_ctx), 'hook puts the new tenant in the JWT');
select is(app.roles(), '{admin,executive,manager}'::app.role[], 'creator gets admin/executive/manager');
select is((select count(*)::int from app.calendars where is_default), 1, 'default calendar created');
select is((select count(*)::int from app.calendar_shifts), 12, 'Mon–Sat two shifts per day');
select is((select count(*)::int from app.warehouses where is_default), 1, 'default warehouse created');

-- Document numbering (BR-R10, D-06) -------------------------------------------
select is(app.next_doc_no('SO'), 'SO-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY') || '-0001', 'first SO number');
select is(app.next_doc_no('SO'), 'SO-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY') || '-0002', 'numbers increment');
select is(app.next_doc_no('JOB'), 'JOB-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY') || '-0001', 'each doc type has its own sequence');

update app.tenants set settings = jsonb_set(settings, '{doc_numbering,year}', '"be"');
select is(app.next_doc_no('DO'),
          'DO-' || (extract(year from now() at time zone 'Asia/Bangkok')::int + 543) || '-0001',
          'Buddhist-era year when configured');

-- Platform-managed columns are not editable by tenant admins
select throws_ok($$ update app.tenants set plan_id = 'business' $$, '42501', null, 'admin cannot change own plan');

-- Members ---------------------------------------------------------------------
select throws_ok($$ select api.add_member('nobody@x.test', '{staff}') $$, 'P0001', 'member.user_not_found', 'unknown email rejected');

reset role;
select tests.user('u' || g || '@a.test') from generate_series(1, 5) g;
select tests.login(tests.user('owner@a.test'));

select lives_ok($$ select api.add_member('u1@a.test', '{supervisor}') $$, 'admin adds a supervisor');
select lives_ok($$ select api.add_member('u2@a.test', '{staff}'); select api.add_member('u3@a.test', '{staff}'); select api.add_member('u4@a.test', '{staff}') $$,
                'trial plan allows 5 users');
select throws_ok($$ select api.add_member('u5@a.test', '{staff}') $$, 'P0001', 'Plan limit reached: 5 users', 'trial plan blocks the 6th user (D-11)');

select throws_ok(
  $$ select api.set_member_roles((select id from app.memberships where user_id = auth.uid()), '{manager}') $$,
  'P0001', 'member.last_admin', 'cannot remove the last admin');

reset role;
select tests.login(tests.user('u1@a.test'));
select throws_ok($$ select api.add_member('u5@a.test', '{staff}') $$, 'P0001', 'auth.forbidden', 'supervisor cannot add members');

-- Switching tenants
select throws_ok($$ select api.switch_tenant(gen_random_uuid()) $$, 'P0001', 'tenant.not_member', 'cannot switch into a foreign tenant');

-- Audit (BR-09)
reset role;
select ok(exists (select 1 from audit.logs where table_name = 'tenants' and record_id = (select tenant_a from t_ctx)),
          'tenant creation is audited');
select ok(exists (select 1 from audit.logs where table_name = 'tenants' and operation = 'UPDATE'
                  and diff ? 'settings'), 'settings change is audited as a diff');

select * from finish();
rollback;
