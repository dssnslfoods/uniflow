-- Artwork proofs (FR-6, BR-R06) and the proof gate.
begin;
\ir ../helpers/auth.sql
select plan(16);

create temp table t_ctx as select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'), '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('mgr@a.test'), '{manager}');
select tests.member((select tenant_a from t_ctx), tests.user('design@a.test'), '{staff}');
insert into app.platform_admins (user_id) values (tests.user('root@uniflow.test'));
select app.seed_demo((select tenant_a from t_ctx), tests.user('owner@a.test'));

create function tests.job(p_title text) returns uuid language sql as $$ select id from app.jobs where title = p_title $$;
create function tests.step(p_title text, p_code text) returns uuid language sql as $$
  select s.id from app.job_steps s join app.processes p on p.id = s.process_id where s.job_id = tests.job(p_title) and p.code = p_code $$;
create function tests.proof(p_version int) returns app.proofs language sql as $$
  select * from app.proofs where job_id = tests.job('แคตตาล็อก A5') and version = p_version $$;
grant execute on function tests.job(text), tests.step(text, text), tests.proof(int) to authenticated;

-- Module off by default
select tests.login(tests.user('design@a.test'));
select throws_ok($$ select api.submit_proof(tests.job('กล่องครีม 50 ml'), 'x/y.pdf') $$, 'P0001', 'Module not enabled: proof', 'proof commands blocked when off');
reset role;
select tests.login(tests.user('root@uniflow.test'));
select api.admin_set_modules((select tenant_a from t_ctx), '{outsource,delivery,inventory,proof}');
reset role;
select tests.login(tests.user('owner@a.test'));
select api.update_tenant_settings(null, '{"features": {"proof_gate": true}}');

-- A catalogue job: DESIGN → OFFSET, approved and released
reset role;
select tests.login(tests.user('sup@a.test'));
select api.create_job(o.id, 'แคตตาล็อก A5', null,
  (select jsonb_agg(jsonb_build_object('sales_order_item_id', i.id, 'qty', i.qty)) from app.sales_order_items i where i.sales_order_id = o.id))
from app.sales_orders o where o.customer_po_no = 'DEMO-GREEN-031';
insert into app.job_steps (job_id, seq, process_id, planned_qty)
select tests.job('แคตตาล็อก A5'), x.seq, p.id, 3000
from (values (1, 'DESIGN'), (2, 'OFFSET')) x(seq, code) join app.processes p on p.code = x.code;
select api.submit_po_plan((select id from app.sales_orders where customer_po_no = 'DEMO-GREEN-031'));
reset role;
select tests.login(tests.user('mgr@a.test'));
select api.approve_po_plan((select id from app.sales_orders where customer_po_no = 'DEMO-GREEN-031'));
reset role;
select tests.login(tests.user('sup@a.test'));
select api.release_jobs(array[tests.job('แคตตาล็อก A5')]);
select api.start_step(tests.step('แคตตาล็อก A5', 'DESIGN'));

-- BR-R06: no approved proof → design cannot finish
select throws_ok($$ select api.complete_step(tests.step('แคตตาล็อก A5', 'DESIGN'), 1, 0) $$, 'P0001',
                 'The customer has not approved a proof for this job', 'design step waits for an approved proof');

-- Versions (FR-6.1)
reset role;
select tests.login(tests.user('design@a.test'));
select throws_ok($$ select api.submit_proof(tests.job('แคตตาล็อก A5'), '') $$, 'P0001', 'proof.file_required', 'a proof needs a file');
select throws_ok($$ select api.submit_proof(tests.job('แคตตาล็อก A5'), gen_random_uuid() || '/x.pdf') $$, 'P0001', 'proof.file_required', 'file must sit in the shop folder');
select lives_ok($$ select api.submit_proof(tests.job('แคตตาล็อก A5'), (select tenant_a from t_ctx) || '/j/v1.pdf', 'catalog-v1.pdf') $$, 'designer submits a proof');
reset role;
select ok(exists (select 1 from app.notifications where kind = 'proof_submitted' and user_id = tests.user('sup@a.test')), 'supervisors are told a proof is ready');
select tests.login(tests.user('design@a.test'));
select api.submit_proof(tests.job('แคตตาล็อก A5'), (select tenant_a from t_ctx) || '/j/v2.pdf', 'catalog-v2.pdf', 'แก้โลโก้');
select is((tests.proof(1)).status::text, 'superseded', 'newer version supersedes the waiting one');
select is((tests.proof(2)).status::text, 'pending', 'latest version waits for the customer');
select throws_ok(format($$ select api.decide_proof(%L, true) $$, (tests.proof(2)).id), 'P0001', 'auth.forbidden', 'staff cannot record the customer decision');

-- Customer decision (FR-6.2/6.3)
reset role;
select tests.login(tests.user('sup@a.test'));
select throws_ok(format($$ select api.decide_proof(%L, false, 'คุณนิด') $$, (tests.proof(2)).id), 'P0001', 'proof.comment_required', 'rejection needs the customer comment');
select lives_ok(format($$ select api.decide_proof(%L, false, 'คุณนิด', 'สีแดงเข้มไป') $$, (tests.proof(2)).id), 'customer asks for changes');
select throws_ok(format($$ select api.decide_proof(%L, true) $$, (tests.proof(2)).id), 'P0001', 'proof.not_pending', 'a decided proof is final');
reset role;
select tests.login(tests.user('design@a.test'));
select api.submit_proof(tests.job('แคตตาล็อก A5'), (select tenant_a from t_ctx) || '/j/v3.pdf', 'catalog-v3.pdf');
reset role;
select ok(exists (select 1 from app.notifications where kind = 'proof_rejected' and user_id = tests.user('design@a.test')), 'designer hears about the rejection');
reset role;
select tests.login(tests.user('sup@a.test'));
select api.decide_proof((tests.proof(3)).id, true, 'คุณนิด');
select lives_ok($$ select api.complete_step(tests.step('แคตตาล็อก A5', 'DESIGN'), 1, 0) $$, 'approved proof lets design finish');
select is((select status::text from app.job_steps where id = tests.step('แคตตาล็อก A5', 'OFFSET')), 'ready', 'printing is next');
select ok(exists (select 1 from app.job_activity_logs where job_id = tests.job('แคตตาล็อก A5') and action = 'proof_approved'), 'decision is in the job log');

select * from finish();
rollback;
