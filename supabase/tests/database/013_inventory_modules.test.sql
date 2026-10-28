-- Inventory (FR-8, BR-R07) and per-shop modules.
begin;
\ir ../helpers/auth.sql
select plan(30);

create temp table t_ctx as select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'), '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('mgr@a.test'), '{manager}');
insert into app.platform_admins (user_id) values (tests.user('root@uniflow.test'));
select app.seed_demo((select tenant_a from t_ctx), tests.user('owner@a.test'));

create function tests.mat(p_code text) returns uuid language sql as $$ select id from app.materials where code = p_code $$;
create function tests.job(p_title text) returns uuid language sql as $$ select id from app.jobs where title = p_title $$;
create function tests.stock(p_code text) returns app.stock_balances language sql as $$
  select b.* from app.stock_balances b join app.materials m on m.id = b.material_id where m.code = p_code $$;
create function tests.jm(p_title text, p_code text) returns app.job_materials language sql as $$
  select jm.* from app.job_materials jm where jm.job_id = tests.job(p_title) and jm.material_id = tests.mat(p_code) $$;
grant execute on function tests.mat(text), tests.job(text), tests.stock(text), tests.jm(text, text) to authenticated;

-- Receipts and moving average (FR-8.1, 8.4)
select tests.login(tests.user('sup@a.test'));
select lives_ok($$ select api.receive_stock(tests.mat('P-ART260'), 1000, 2.5, 'INV-001') $$, 'supervisor receives stock');
select api.receive_stock(tests.mat('P-ART260'), 1000, 3.5);
select is((select avg_cost from app.stock_v where code = 'P-ART260'), null::numeric, 'supervisor does not see cost');
select is((select on_hand from app.stock_v where code = 'P-ART260'), 2000::numeric, 'on hand adds up');
reset role;
select is((tests.stock('P-ART260')).avg_cost, 3.0::numeric, 'moving average cost');

-- BOM and reservation on a running job (FR-4.5, 8.2, 8.3)
select tests.login(tests.user('sup@a.test'));
select is(api.set_job_materials(tests.job('กล่องครีม 50 ml'),
          jsonb_build_array(jsonb_build_object('material_id', tests.mat('P-IVORY350'), 'required_qty', 5500))), true,
          'BOM on an empty shelf reports a shortage');
select is((select shortage from app.stock_v where code = 'P-IVORY350'), 5500::numeric, 'shortage visible in stock view');
select api.receive_stock(tests.mat('P-IVORY350'), 6000, 4);
select is((tests.jm('กล่องครีม 50 ml', 'P-IVORY350')).reserved_qty, 5500::numeric, 'receipt reserves for the short job');
select is((select available from app.stock_v where code = 'P-IVORY350'), 500::numeric, 'available = on hand − reserved');

-- Issue / return (FR-8.1)
select lives_ok($$ select api.issue_material(tests.job('กล่องครีม 50 ml'), tests.mat('P-IVORY350'), 3000) $$, 'issue to the job');
select is((tests.jm('กล่องครีม 50 ml', 'P-IVORY350')).reserved_qty, 2500::numeric, 'issue consumes the reservation');
select is((select on_hand from app.stock_v where code = 'P-IVORY350'), 3000::numeric, 'stock goes down');
select lives_ok($$ select api.issue_material(tests.job('กล่องครีม 50 ml'), tests.mat('P-IVORY350'), -500, 'เหลือจากงาน') $$, 'return leftovers');
select throws_ok($$ select api.issue_material(tests.job('กล่องครีม 50 ml'), tests.mat('P-IVORY350'), -9000) $$,
                 'P0001', 'stock.return_over_issued', 'cannot return more than issued');
select throws_ok($$ select api.issue_material(tests.job('กล่องครีม 50 ml'), tests.mat('P-ART130'), 1) $$,
                 'P0001', 'Not enough stock: 0 on hand', 'cannot issue what is not there');
select is((select count(*)::int from app.stock_movements_v where material_id = tests.mat('P-IVORY350')), 3, 'stock card lists every movement');

-- Adjustments
select throws_ok($$ select api.adjust_stock(tests.mat('P-IVORY350'), 100, 'นับสต็อก') $$, 'P0001', 'auth.forbidden', 'supervisor cannot adjust');
reset role;
select tests.login(tests.user('mgr@a.test'));
select throws_ok($$ select api.adjust_stock(tests.mat('P-IVORY350'), 100, 'นับสต็อก') $$, 'P0001', 'stock.below_reserved', 'cannot count below what is reserved');
select lives_ok($$ select api.adjust_stock(tests.mat('P-IVORY350'), 3400, 'นับสต็อกสิ้นเดือน') $$, 'manager adjusts to the count');

-- Stock gate on release (BR-R07)
reset role;
select tests.login(tests.user('owner@a.test'));
select api.update_tenant_settings(null, '{"features": {"stock_gate": true}}');
select is((select settings #>> '{features,proof_gate}' from app.tenants where id = (select tenant_a from t_ctx)), 'false', 'other gate untouched');
reset role;
select tests.login(tests.user('sup@a.test'));
select api.set_job_materials(tests.job('กล่องขนมเปี๊ยะ 6 ชิ้น'),
  jsonb_build_array(jsonb_build_object('material_id', tests.mat('P-IVORY350'), 'required_qty', 99999)));
reset role;
select tests.login(tests.user('mgr@a.test'));
select api.approve_po_plan((select sales_order_id from app.jobs where title = 'กล่องขนมเปี๊ยะ 6 ชิ้น'));
reset role;
select tests.login(tests.user('sup@a.test'));
select ok(exists (select 1 from app.notifications where kind = 'stock_short'), 'approval of a short job alerts');
select throws_ok($$ select api.release_jobs(array[tests.job('กล่องขนมเปี๊ยะ 6 ชิ้น')]) $$, 'P0001', 'Not enough material for JOB-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY') || '-0005',
                 'short job cannot be released');
select throws_ok($$ select api.release_jobs(array[tests.job('กล่องขนมเปี๊ยะ 6 ชิ้น')], 'ลูกค้ารีบ') $$, 'P0001', 'release.override_needs_manager', 'override needs a manager');
reset role;
select tests.login(tests.user('mgr@a.test'));
select is(api.release_jobs(array[tests.job('กล่องขนมเปี๊ยะ 6 ชิ้น')], 'ลูกค้ารีบ กระดาษเข้าพรุ่งนี้'), 1, 'manager overrides with a reason');
select ok(exists (select 1 from app.job_activity_logs where action = 'stock_override'), 'override is logged');
select api.cancel_job(tests.job('กล่องขนมเปี๊ยะ 12 ชิ้น'), 'ลูกค้ายกเลิก');

-- Modules (super admin)
reset role;
select tests.login(tests.user('owner@a.test'));
select throws_ok(format($$ select api.admin_set_modules(%L, '{inventory}') $$, (select tenant_a from t_ctx)), 'P0001', 'auth.forbidden', 'shop admin cannot change modules');
select throws_ok($$ update app.tenants set modules = '{}' $$, '42501', null, 'modules column is not writable by shops');
reset role;
select tests.login(tests.user('root@uniflow.test'));
select throws_ok(format($$ select api.admin_set_modules(%L, '{teleport}') $$, (select tenant_a from t_ctx)), 'P0001', 'module.unknown', 'unknown module rejected');
select is(api.admin_set_modules((select tenant_a from t_ctx), '{delivery}'), '{delivery}'::text[], 'platform admin sets modules');
reset role;
select tests.login(tests.user('sup@a.test'));
select throws_ok($$ select api.receive_stock(tests.mat('P-ART260'), 1, 1) $$, 'P0001', 'Module not enabled: inventory', 'inventory commands blocked when off');
select throws_ok($$ select api.send_outsource(gen_random_uuid(), gen_random_uuid(), 1, now() + interval '1 day') $$,
                 'P0001', 'Module not enabled: outsource', 'outsource commands blocked when off');

select * from finish();
rollback;
