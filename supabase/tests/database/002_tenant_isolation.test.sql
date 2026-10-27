-- RLS matrix (SRS §12, §15): a member of tenant B can never read or write tenant A data,
-- for every table in schema app. New tables are covered automatically.
begin;
\ir ../helpers/auth.sql
select plan(9);

-- Fixtures: two tenants with a full set of master data each ------------------
create function tests.seed_masters(p_admin uuid) returns void language plpgsql as $$
declare v_proc uuid; v_mach uuid; v_vendor uuid; v_mat uuid; v_tpl uuid; v_cal uuid;
begin
  perform tests.login(p_admin);
  select id into v_cal from app.calendars limit 1;
  insert into app.holidays (day, name) values ('2026-12-31', 'สิ้นปี');
  insert into app.processes (code, name, step_type) values ('PRINT', 'พิมพ์ออฟเซ็ท', 'internal') returning id into v_proc;
  insert into app.machines (code, name, max_cap_per_hour, calendar_id) values ('SM74', 'Heidelberg SM74', 8000, v_cal) returning id into v_mach;
  insert into app.machine_costs (machine_id, cost_per_hour) values (v_mach, 1200);
  insert into app.machine_processes (machine_id, process_id) values (v_mach, v_proc);
  insert into app.member_skills (membership_id, process_id)
    select id, v_proc from app.memberships where user_id = p_admin;
  insert into app.customers (code, name) values ('C001', 'ลูกค้า');
  insert into app.vendors (code, name) values ('V001', 'ร้านเคลือบ') returning id into v_vendor;
  insert into app.vendor_services (vendor_id, process_id) values (v_vendor, v_proc);
  insert into app.materials (code, name, uom) values ('P-ART130', 'อาร์ตมัน 130g', 'แผ่น') returning id into v_mat;
  insert into app.material_costs (material_id, std_cost) values (v_mat, 2.5);
  insert into app.workflow_templates (name) values ('นามบัตร') returning id into v_tpl;
  insert into app.workflow_template_steps (template_id, seq, process_id) values (v_tpl, 1, v_proc);
  insert into app.sales_orders (customer_id, customer_po_no, due_date)
    select id, 'PO-1', current_date + 7 from app.customers;
  insert into app.sales_order_items (sales_order_id, line_no, description, qty)
    select id, 1, 'นามบัตร', 1000 from app.sales_orders;
end $$;

create temp table t_ctx as
select tests.tenant(tests.user('admin@a.test'), 'A') as tenant_a,
       tests.tenant(tests.user('admin@b.test'), 'B') as tenant_b;
grant select on t_ctx to public;

select tests.seed_masters(tests.user('admin@a.test'));
reset role;
select tests.seed_masters(tests.user('admin@b.test'));
reset role;

-- Every app table has RLS on ---------------------------------------------------
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind = 'r' and not c.relrowsecurity
$$, 'RLS is enabled on every table in schema app');

create function tests.tenant_tables() returns setof text language sql as $$
  select c.table_name::text from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'app' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
  order by 1
$$;

create function tests.count_rows(p_table text, p_tenant uuid) returns int language plpgsql as $$
declare v int;
begin
  execute format('select count(*) from app.%I where tenant_id = $1', p_table) into v using p_tenant;
  return v;
end $$;

-- Every tenant table really holds data for tenant A, otherwise the checks below prove nothing
select is_empty($$
  select t from tests.tenant_tables() t where tests.count_rows(t, (select tenant_a from t_ctx)) = 0
$$, 'fixtures cover every tenant table');

create function tests.try_update_all(p_tenant uuid) returns int language plpgsql as $$
declare t text; n int; total int := 0;
begin
  for t in select * from tests.tenant_tables() loop
    -- tables without an UPDATE grant (written only via api.*) are protected even more strongly
    continue when not has_table_privilege('authenticated', 'app.' || t, 'UPDATE');
    execute format('update app.%I set tenant_id = tenant_id where tenant_id = $1', t) using p_tenant;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end $$;

-- As tenant B's admin ---------------------------------------------------------
select tests.login(tests.user('admin@b.test'));

select is_empty($$
  select t from tests.tenant_tables() t where tests.count_rows(t, (select tenant_a from t_ctx)) > 0
$$, 'tenant B reads zero rows of tenant A in every table');

select is_empty($$ select 1 from app.tenants where id = (select tenant_a from t_ctx) $$, 'tenant A is invisible');
select is_empty($$ select 1 from app.memberships where tenant_id = (select tenant_a from t_ctx) $$, 'tenant A members are invisible');


select is(tests.try_update_all((select tenant_a from t_ctx)), 0, 'updates against tenant A touch zero rows');

select throws_ok(
  format($$ insert into app.customers (tenant_id, code, name) values (%L, 'X', 'spoof') $$, (select tenant_a from t_ctx)),
  '42501', null, 'cannot insert rows into tenant A');

select throws_ok(
  $$ update app.customers set tenant_id = (select tenant_a from t_ctx) $$,
  '42501', null, 'cannot move own rows into tenant A');

-- Composite FKs stop cross-tenant references even if an id leaks
reset role;
create temp table t_leak as select id as proc_a from app.processes where tenant_id = (select tenant_a from t_ctx);
grant select on t_leak to public;
select tests.login(tests.user('admin@b.test'));
select throws_ok(
  $$ insert into app.machine_processes (machine_id, process_id)
     select m.id, (select proc_a from t_leak) from app.machines m limit 1 $$,
  '23503', null, 'cannot link own machine to tenant A process');

select * from finish();
rollback;
