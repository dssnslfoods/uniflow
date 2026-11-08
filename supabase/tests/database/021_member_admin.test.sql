-- Shop admins manage their own people; accounts shared with another shop stay untouchable.
begin;
\ir ../helpers/auth.sql
select plan(14);

create temp table t_ctx as
select tests.tenant(tests.user('admin@a.test'), 'A') as tenant_a,
       tests.tenant(tests.user('admin@b.test'), 'B') as tenant_b;
grant select on t_ctx to public;
select tests.member((select tenant_b from t_ctx), tests.user('other@b.test'), '{staff}');
create temp table t_m as
select tests.member((select tenant_a from t_ctx), tests.user('staff@a.test'), '{staff}') as staff,
       tests.member((select tenant_a from t_ctx), tests.user('shared@x.test'), '{staff}') as shared,
       tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'), '{supervisor}') as sup,
       (select id from app.memberships where user_id = tests.user('admin@a.test')) as admin_a,
       tests.user('staff@a.test') as staff_user,
       (select id from app.memberships where user_id = tests.user('other@b.test')) as other_b;
select tests.member((select tenant_b from t_ctx), tests.user('shared@x.test'), '{staff}');
grant select on t_m to public;

select tests.login(tests.user('admin@a.test'));
select is((select only_here from api.list_members() where email = 'staff@a.test'), true, 'a shop-only account is flagged');
select is((select only_here from api.list_members() where email = 'shared@x.test'), false, 'an account in two shops is flagged');

select lives_ok($$ select api.set_member_name((select staff from t_m), '  สมชาย ใจดี  ') $$, 'admin renames own member');
reset role;
select is((select full_name from app.profiles where id = (select staff_user from t_m)), 'สมชาย ใจดี', 'name trimmed and saved');
select tests.login(tests.user('admin@a.test'));
select throws_ok($$ select api.set_member_name((select shared from t_m), 'x') $$, 'P0001', 'member.shared_account', 'cannot rename an account another shop uses');

select is(api.assert_can_set_password((select staff from t_m)), (select staff_user from t_m), 'password change allowed for own member');
select throws_ok($$ select api.assert_can_set_password((select shared from t_m)) $$, 'P0001', 'member.shared_account', 'no password change on a shared account');
select throws_ok($$ select api.assert_can_set_password((select admin_a from t_m)) $$, 'P0001', 'member.use_own_settings', 'own password goes through the normal flow');
select throws_ok($$ select api.assert_can_set_password((select other_b from t_m)) $$,
                 'P0001', 'member.not_found', 'a member of another shop is invisible');

select throws_ok($$ select api.remove_member((select admin_a from t_m)) $$, 'P0001', 'member.cannot_remove_self', 'admin cannot remove themself');
select lives_ok($$ select api.remove_member((select shared from t_m)) $$, 'admin removes a member from the shop');
reset role;
select ok(exists (select 1 from app.memberships m join auth.users u on u.id = m.user_id where u.email = 'shared@x.test' and tenant_id = (select tenant_b from t_ctx)),
          'their other shop keeps them');

select tests.login(tests.user('sup@a.test'));
select throws_ok($$ select api.remove_member((select staff from t_m)) $$, 'P0001', 'auth.forbidden', 'only admins remove members');
select throws_ok($$ select api.set_member_name((select staff from t_m), 'x') $$, 'P0001', 'auth.forbidden', 'only admins rename members');

select * from finish();
rollback;
