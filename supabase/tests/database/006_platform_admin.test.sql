-- Platform super admin: sees and manages every tenant; support access is explicit and audited.
begin;
\ir ../helpers/auth.sql
select plan(17);

create temp table t_ctx as
select tests.tenant(tests.user('owner-a@x.test'), 'A', 'trial') as tenant_a,
       tests.tenant(tests.user('owner-b@x.test'), 'B') as tenant_b;
grant select on t_ctx to public;
insert into app.platform_admins (user_id, note) values (tests.user('root@uniflow.test'), 'test');

-- Regular tenant admin
select tests.login(tests.user('owner-a@x.test'));
select is((auth.jwt() ->> 'platform_admin')::boolean, false, 'tenant admin is not a platform admin');
select throws_ok($$ select * from api.admin_list_tenants() $$, 'P0001', 'auth.forbidden', 'tenant admin cannot list all tenants');
select throws_ok($$ select api.admin_update_tenant((select tenant_b from t_ctx), 'business') $$, 'P0001', 'auth.forbidden', 'tenant admin cannot change plans');
select is_empty($$ select 1 from app.platform_admins $$, 'platform admin list is hidden from others');
select throws_ok($$ insert into app.platform_admins (user_id) values (auth.uid()) $$, '42501', null, 'cannot make yourself a platform admin');

-- Super admin
reset role;
select tests.login(tests.user('root@uniflow.test'));
select is((auth.jwt() ->> 'platform_admin')::boolean, true, 'hook flags the platform admin');
select is(app.tenant_id(), null::uuid, 'platform admin has no tenant by default');
select is((select count(*)::int from api.admin_list_tenants()), 2, 'sees every tenant');
select is((select owner_email from api.admin_list_tenants() where tenant_id = (select tenant_a from t_ctx)), 'owner-a@x.test', 'owner email listed');
select is_empty($$ select 1 from app.machines $$, 'no tenant data without entering a tenant');

select lives_ok($$ select api.admin_update_tenant((select tenant_a from t_ctx), 'pro') $$, 'changes a tenant plan');

-- Support access into tenant A
select api.admin_enter_tenant((select tenant_a from t_ctx));
reset role;
select tests.login(tests.user('root@uniflow.test'));
select is(app.tenant_id(), (select tenant_a from t_ctx), 'entering switches the JWT tenant');
select is(app.roles(), '{admin,executive,manager}'::app.role[], 'support access has full tenant roles');
select ok((select supporting from api.admin_list_tenants() where tenant_id = (select tenant_a from t_ctx)), 'list shows active support session');

-- Visible to the tenant and audited
reset role;
select ok(exists (select 1 from audit.logs where table_name = 'memberships' and diff ->> 'is_support' = 'true'), 'support entry is audited');
select tests.login(tests.user('owner-a@x.test'));
select ok(exists (select 1 from app.memberships where is_support), 'tenant sees the support member');

reset role;
select tests.login(tests.user('root@uniflow.test'));
select api.admin_leave_tenant((select tenant_a from t_ctx));
reset role;
select is((select is_active from app.memberships m join auth.users u on u.id = m.user_id
           where u.email = 'root@uniflow.test'), false, 'leaving deactivates support access');

select * from finish();
rollback;
