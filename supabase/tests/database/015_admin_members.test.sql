-- Platform console: open a shop, give it admins, choose modules.
begin;
\ir ../helpers/auth.sql
select plan(14);

create temp table t_ctx as
select tests.tenant(tests.user('owner-a@x.test'), 'A') as tenant_a,
       tests.user('root@uniflow.test') as root,
       tests.user('boss@newshop.test') as boss,
       tests.user('clerk@newshop.test') as clerk;
grant select on t_ctx to public;
insert into app.platform_admins (user_id) values ((select root from t_ctx));

-- Shop admins cannot use the console commands
select tests.login(tests.user('owner-a@x.test'));
select throws_ok($$ select api.admin_create_tenant('แอบเปิดร้าน') $$, 'P0001', 'auth.forbidden', 'shop admin cannot open shops');
select throws_ok(format($$ select * from api.admin_list_members(%L) $$, (select tenant_a from t_ctx)), 'P0001', 'auth.forbidden', 'shop admin cannot use the console member list');

-- Super admin opens a shop with chosen modules
reset role;
select tests.login((select root from t_ctx));
select throws_ok($$ select api.admin_create_tenant(' ') $$, 'P0001', 'tenant.name_required', 'shop needs a name');
select throws_ok($$ select api.admin_create_tenant('ร้านใหม่', 'gold') $$, 'P0001', 'tenant.unknown_plan', 'plan must exist');
create temp table t_new as select api.admin_create_tenant('โรงพิมพ์ใหม่', 'starter', '{delivery}') as id;
grant select on t_new to public;
reset role;
select is((select modules from app.tenants where id = (select id from t_new)), '{delivery}'::text[], 'modules chosen at creation');
select is((select count(*)::int from app.memberships where tenant_id = (select id from t_new)), 0, 'super admin is not a member of the new shop');
select ok(exists (select 1 from app.warehouses where tenant_id = (select id from t_new) and is_default), 'shop defaults are created');
select tests.login((select root from t_ctx));

-- Admins for the shop
select throws_ok(format($$ select api.admin_add_member(%L, 'nobody@x.test', '{admin}') $$, (select id from t_new)), 'P0001', 'member.user_not_found', 'account must exist first');
select lives_ok(format($$ select api.admin_add_member(%L, 'Boss@NewShop.test', '{admin}') $$, (select id from t_new)), 'super admin adds the shop admin');
select api.admin_add_member((select id from t_new), 'clerk@newshop.test', '{staff}');
select is((select count(*)::int from api.admin_list_members((select id from t_new))), 2, 'members listed');
select throws_ok(format($$ select api.admin_set_member(%L, '{manager}') $$,
                        (select membership_id from api.admin_list_members((select id from t_new)) where email = 'boss@newshop.test')),
                 'P0001', 'member.last_admin', 'a shop keeps one admin');

-- The new admin runs their own shop
reset role;
select tests.login((select boss from t_ctx));
select is(app.tenant_id(), (select id from t_new), 'new admin lands in the shop');
select lives_ok($$ select api.add_member('clerk@newshop.test', '{supervisor}') $$, 'shop admin manages their own people');
select is((select roles from app.memberships where user_id = (select clerk from t_ctx)), '{supervisor}'::app.role[], 'role updated by the shop admin');

select * from finish();
rollback;
