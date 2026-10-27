-- PO intake → Sales Order (M3, D-09, D-17).
begin;
\ir ../helpers/auth.sql
select plan(18);

create temp table t_ctx as
select tests.tenant(tests.user('admin@a.test'), 'A') as tenant_a,
       tests.tenant(tests.user('admin@b.test'), 'B') as tenant_b;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'),   '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('staff@a.test'), '{staff}');

select tests.login(tests.user('admin@b.test'));
insert into app.customers (code, name) values ('CB', 'ลูกค้า B');
reset role;

-- Supervisor enters a PO --------------------------------------------------------
select tests.login(tests.user('sup@a.test'));
insert into app.customers (code, name) values ('C001', 'บริษัท ABC');

create temp table t_so as
with so as (
  insert into app.sales_orders (customer_id, customer_po_no, due_date)
  select id, 'PO-7781', current_date + 14 from app.customers where code = 'C001'
  returning id, doc_no, status
) select * from so;

select is((select doc_no from t_so), 'SO-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY') || '-0001', 'SO number assigned automatically');
select is((select status::text from t_so), 'draft', 'new SO is a draft');

select throws_ok($$ insert into app.sales_orders (customer_id, customer_po_no)
                    select id, 'PO-7781' from app.customers where code = 'C001' $$,
                 '23505', null, 'same customer PO number cannot be entered twice');

select throws_ok($$ select api.confirm_sales_order((select id from t_so)) $$, 'P0001', 'order.no_items', 'cannot confirm without items');

insert into app.sales_order_items (sales_order_id, line_no, description, qty, unit_price)
select id, 1, 'กล่องครีม 3 ชั้น', 5000, 4.5 from t_so
union all
select id, 2, 'ฉลากสติ๊กเกอร์', 10000, 0.8 from t_so;

select lives_ok($$ select api.confirm_sales_order((select id from t_so)) $$, 'supervisor confirms the PO');
select is((select status::text from app.sales_orders where id = (select id from t_so)), 'confirmed', 'status is confirmed');

-- Confirmed SOs are frozen outside api.*
select throws_ok($$ update app.sales_orders set customer_po_no = 'X' where id = (select id from t_so) $$,
                 'P0001', 'order.not_draft', 'confirmed SO header is read-only');
select throws_ok($$ update app.sales_order_items set qty = 1 where sales_order_id = (select id from t_so) $$,
                 'P0001', 'order.not_draft', 'confirmed SO items are read-only');
select throws_ok($$ insert into app.sales_order_items (sales_order_id, line_no, description, qty)
                    select id, 3, 'เพิ่ม', 1 from t_so $$,
                 'P0001', 'order.not_draft', 'cannot add items to a confirmed SO');
select lives_ok($$ delete from app.sales_orders where id = (select id from t_so) $$, 'delete on a confirmed SO is a no-op');
select ok(exists (select 1 from app.sales_orders where id = (select id from t_so)), 'confirmed SO still exists');

-- Status only through api.*
insert into app.sales_orders (customer_id, customer_po_no) select id, 'PO-2' from app.customers where code = 'C001';
select throws_ok($$ update app.sales_orders set status = 'confirmed' where customer_po_no = 'PO-2' $$,
                 'P0001', 'order.status_via_api', 'status cannot be set directly');
select throws_ok($$ select api.confirm_sales_order((select id from app.sales_orders where customer_po_no = 'PO-2')) $$,
                 'P0001', 'order.no_items', 'PO-2 still needs items');
select throws_ok($$ select api.reopen_sales_order((select id from t_so)) $$,
                 'P0001', 'auth.forbidden', 'supervisor cannot reopen a confirmed SO');

-- Manager reopens / cancels
reset role;
select tests.login(tests.user('admin@a.test'));
select lives_ok($$ select api.reopen_sales_order((select id from t_so)) $$, 'manager reopens for corrections');
select throws_ok($$ select api.cancel_sales_order((select id from t_so), ' ') $$,
                 'P0001', 'order.reason_required', 'cancelling needs a reason');

-- Staff and other tenants
reset role;
select tests.login(tests.user('staff@a.test'));
select throws_ok($$ insert into app.sales_orders (customer_id, customer_po_no)
                    select id, 'PO-S' from app.customers limit 1 $$,
                 '42501', null, 'staff cannot enter POs');

reset role;
create temp table t_leak as select id from app.customers where code = 'CB';
grant select on t_leak to public;
select tests.login(tests.user('sup@a.test'));
select throws_ok($$ insert into app.sales_orders (customer_id, customer_po_no) select id, 'PO-X' from t_leak $$,
                 '23503', null, 'cannot attach another tenant''s customer');

select * from finish();
rollback;
