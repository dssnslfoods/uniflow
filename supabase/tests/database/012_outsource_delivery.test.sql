-- Outsource orders (FR-7) and deliveries (FR-9).
begin;
\ir ../helpers/auth.sql
select plan(27);

create temp table t_ctx as select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'), '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('staff@a.test'), '{staff}');
select app.seed_demo((select tenant_a from t_ctx), tests.user('owner@a.test'));

create function tests.step(p_job_title text, p_code text) returns app.job_steps language plpgsql as $$
declare r app.job_steps;
begin
  select s.* into r from app.job_steps s join app.jobs j on j.id = s.job_id join app.processes p on p.id = s.process_id
  where j.title = p_job_title and p.code = p_code and not s.is_rework;
  return r;
end $$;
create function tests.run(p_job_title text, p_code text, p_good numeric) returns void language plpgsql as $$
begin
  perform api.start_step((tests.step(p_job_title, p_code)).id);
  perform api.complete_step((tests.step(p_job_title, p_code)).id, p_good, 0);
end $$;
grant execute on function tests.step(text, text), tests.run(text, text, numeric) to authenticated;

-- Box job: PLATE → OFFSET → COAT (outsource) → DIECUT → GLUE → QC → PACK
select tests.login(tests.user('sup@a.test'));
select tests.run('กล่องครีม 50 ml', 'PLATE', 4);
select tests.run('กล่องครีม 50 ml', 'OFFSET', 5000);
select is((tests.step('กล่องครีม 50 ml', 'COAT')).status::text, 'ready', 'coating is ready to send out');

select throws_ok(format($$ select api.send_outsource(%L, (select id from app.vendors limit 1), 5000, now() + interval '2 days') $$,
                        (tests.step('กล่องครีม 50 ml', 'DIECUT')).id),
                 'P0001', 'outsource.not_outsource_step', 'only outsource steps go to vendors');
select throws_ok(format($$ select api.send_outsource(%L, (select id from app.vendors limit 1), 5000, now() - interval '1 hour') $$,
                        (tests.step('กล่องครีม 50 ml', 'COAT')).id),
                 'P0001', 'outsource.expected_in_past', 'promised date must be in the future');

create temp table t_os as
select api.send_outsource((tests.step('กล่องครีม 50 ml', 'COAT')).id, (select id from app.vendors where code = 'V-UV'),
                          5000, date_trunc('hour', now()) + interval '3 days', 3500, 'เคลือบ UV เงา') as id;
grant select on t_os to public;
select ok((select doc_no like 'OS-%' from app.outsource_orders where id = (select id from t_os)), 'order number assigned');
select is((tests.step('กล่องครีม 50 ml', 'COAT')).status::text, 'in_progress', 'outsource step runs while at the vendor');
select is((tests.step('กล่องครีม 50 ml', 'COAT')).planned_end, date_trunc('hour', now()) + interval '3 days', 'schedule uses the promised date');
select ok((tests.step('กล่องครีม 50 ml', 'DIECUT')).planned_start >= date_trunc('hour', now()) + interval '3 days', 'die-cutting waits for the coating');
select throws_ok(format($$ select api.send_outsource(%L, (select id from app.vendors limit 1), 1, now() + interval '1 day') $$,
                        (tests.step('กล่องครีม 50 ml', 'COAT')).id),
                 'P0001', 'step.not_ready', 'a step has one open order at a time');

-- Overdue alert
reset role;
update app.outsource_orders set expected_at = now() - interval '2 hours' where id = (select id from t_os);
select is(app.notify_overdue_outsource(), 1, 'late order raises an alert');
select is(app.notify_overdue_outsource(), 0, 'once a day per order');
select tests.login(tests.user('sup@a.test'));
select is((select count(*)::int from app.notifications where kind = 'outsource_overdue'), 1, 'supervisor sees the late order');

-- Receive → QC reject → send again → receive → QC pass
select throws_ok(format($$ select api.qc_outsource(%L, true) $$, (select id from t_os)), 'P0001', 'outsource.not_received', 'QC needs received goods');
select lives_ok(format($$ select api.receive_outsource(%L, 5000, 3600) $$, (select id from t_os)), 'goods received with actual cost');
select throws_ok(format($$ select api.qc_outsource(%L, false, 0, '') $$, (select id from t_os)), 'P0001', 'approval.reason_required', 'rejection needs a reason');
select lives_ok(format($$ select api.qc_outsource(%L, false, 0, 'เคลือบไม่เรียบ') $$, (select id from t_os)), 'QC rejects the batch');
select is((tests.step('กล่องครีม 50 ml', 'COAT')).status::text, 'ready', 'rejected work can be sent again');

create temp table t_os2 as
select api.send_outsource((tests.step('กล่องครีม 50 ml', 'COAT')).id, (select id from app.vendors where code = 'V-UV'),
                          5000, now() + interval '1 day') as id;
grant select on t_os2 to public;
select api.receive_outsource((select id from t_os2), 5000);
select is((api.qc_outsource((select id from t_os2), true, 40, 'มีรอย 40 แผ่น') ->> 'job_done')::boolean, false, 'QC pass');
select is((tests.step('กล่องครีม 50 ml', 'COAT')).good_qty, 4960::numeric, 'good = received − rejected');
select is((tests.step('กล่องครีม 50 ml', 'DIECUT')).status::text, 'ready', 'next stage is ready');
select is((select reject_pct from app.vendor_performance_v where name like 'ร้านเคลือบ%'), round(100.0 * 5040 / 10000, 1),
          'vendor reject rate counts both orders');

-- Delivery: name cards (1,500 pcs) DIGITAL → CUT → PACK
select tests.run('นามบัตร 3 แบบ (พิมพ์รวมแผ่น)', 'DIGITAL', 1500);
select tests.run('นามบัตร 3 แบบ (พิมพ์รวมแผ่น)', 'CUT', 1500);
select tests.run('นามบัตร 3 แบบ (พิมพ์รวมแผ่น)', 'PACK', 1500);
create temp table t_card as select id, sales_order_id from app.jobs where title = 'นามบัตร 3 แบบ (พิมพ์รวมแผ่น)';
grant select on t_card to public;
select is((select status::text from app.jobs where id = (select id from t_card)), 'ready_to_deliver', 'job is ready to deliver');

select throws_ok(format($$ select api.create_delivery(%L, jsonb_build_array(jsonb_build_object('job_id', (select id from app.jobs where title = 'กล่องครีม 50 ml'), 'qty', 1))) $$,
                        (select sales_order_id from t_card)),
                 'P0001', 'delivery.job_not_in_order', 'only jobs of this PO');
select lives_ok(format($$ select api.create_delivery(%L, jsonb_build_array(jsonb_build_object('job_id', %L, 'qty', 1000)), 'คุณภูผา') $$,
                       (select sales_order_id from t_card), (select id from t_card)), 'partial delivery');
select is((select status::text from app.jobs where id = (select id from t_card)), 'partially_delivered', 'job partially delivered');
select throws_ok(format($$ select api.create_delivery(%L, jsonb_build_array(jsonb_build_object('job_id', %L, 'qty', 600))) $$,
                        (select sales_order_id from t_card), (select id from t_card)),
                 'P0001', 'delivery.over_qty', 'cannot deliver more than the job quantity');
select api.create_delivery((select sales_order_id from t_card), jsonb_build_array(jsonb_build_object('job_id', (select id from t_card), 'qty', 500)));
select is((select status::text from app.sales_orders where id = (select sales_order_id from t_card)), 'delivered', 'fully delivered PO is closed (FR-9.3)');

reset role;
select tests.login(tests.user('staff@a.test'));
select throws_ok(format($$ select api.receive_outsource(%L, 1) $$, (select id from t_os2)), 'P0001', 'auth.forbidden', 'staff cannot handle outsource orders');

select * from finish();
rollback;
