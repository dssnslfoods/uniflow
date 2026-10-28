-- Edit after approval → re-approval (FR-4.7, BR-R04, D-04), rework (G-04), machine suggestions (§7.4).
begin;
\ir ../helpers/auth.sql
select plan(23);

create temp table t_ctx as select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'), '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('mgr@a.test'), '{manager}');
select app.seed_demo((select tenant_a from t_ctx), tests.user('owner@a.test'));

create function tests.step(p_job_title text, p_code text) returns app.job_steps language plpgsql as $$
declare r app.job_steps;
begin
  select s.* into r from app.job_steps s join app.jobs j on j.id = s.job_id join app.processes p on p.id = s.process_id
  where j.title = p_job_title and p.code = p_code and not s.is_rework;
  return r;
end $$;
create function tests.flow(p_job_title text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.seq, 'process_id', s.process_id, 'machine_id', s.machine_id,
                                      'planned_qty', s.planned_qty, 'n_up', s.n_up, 'passes', s.passes) order by s.seq, s.id)
  from app.job_steps s join app.jobs j on j.id = s.job_id where j.title = p_job_title
$$;
create function tests.job(p_title text) returns app.jobs language sql as $$ select * from app.jobs where title = p_title $$;
grant execute on function tests.step(text, text), tests.flow(text), tests.job(text) to authenticated;

-- Brochure (released): PLATE → OFFSET → CUT → FOLD → PACK. Start the plate, then edit the flow.
select tests.login(tests.user('sup@a.test'));
select api.start_step((tests.step('โบรชัวร์ Open House', 'PLATE')).id);

select throws_ok(format($$ select api.edit_workflow(%L, %L) $$, (tests.job('โบรชัวร์ Open House')).id,
                        (select jsonb_agg(x) from jsonb_array_elements(tests.flow('โบรชัวร์ Open House')) x
                         where x ->> 'id' <> (tests.step('โบรชัวร์ Open House', 'PLATE')).id::text)),
                 'P0001', 'workflow.locked_step_removed', 'a running step cannot be removed');

select throws_ok(format($$ select api.edit_workflow(%L, %L) $$, (tests.job('โบรชัวร์ Open House')).id,
                        (select jsonb_agg(case when x ->> 'id' = (tests.step('โบรชัวร์ Open House', 'PLATE')).id::text
                                               then jsonb_set(x, '{planned_qty}', '1') else x end)
                         from jsonb_array_elements(tests.flow('โบรชัวร์ Open House')) x)),
                 'P0001', 'workflow.locked_step_changed', 'a running step cannot be changed');

-- Valid edit: fold more per sheet on the print (n_up 4) and drop the FOLD step
select lives_ok(format($$ select api.edit_workflow(%L, %L, 'เปลี่ยนเป็นพิมพ์ 4 หน้าต่อแผ่น') $$, (tests.job('โบรชัวร์ Open House')).id,
                        (select jsonb_agg(case when x ->> 'id' = (tests.step('โบรชัวร์ Open House', 'OFFSET')).id::text
                                               then jsonb_set(x, '{n_up}', '4') else x end)
                         from jsonb_array_elements(tests.flow('โบรชัวร์ Open House')) x
                         where x ->> 'id' <> (tests.step('โบรชัวร์ Open House', 'FOLD')).id::text)),
                'supervisor edits a released flow');
select is((tests.job('โบรชัวร์ Open House')).status::text, 'pending_approval', 'job waits for re-approval (BR-R04)');
select is((tests.job('โบรชัวร์ Open House')).workflow_version, 2, 'new workflow version');
select is((select count(*)::int from app.job_steps s join app.jobs j on j.id = s.job_id where j.title = 'โบรชัวร์ Open House'), 4, 'removed step is gone');
select is((tests.step('โบรชัวร์ Open House', 'OFFSET')).n_up::int, 4, 'change applied');

-- D-04: running work continues, nothing new starts
select lives_ok(format($$ select api.pause_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'PLATE')).id), 'running step can pause during re-approval');
select lives_ok(format($$ select api.start_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'PLATE')).id), '…and resume');
select lives_ok(format($$ select api.complete_step(%L, 4, 0) $$, (tests.step('โบรชัวร์ Open House', 'PLATE')).id), '…and finish');
select throws_ok(format($$ select api.start_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'OFFSET')).id),
                 'P0001', 'step.job_reapproval', 'no new step starts before approval');
select ok((tests.step('โบรชัวร์ Open House', 'OFFSET')).planned_start is not null, 'steps stay on the schedule while waiting');

-- Reject → on hold (a released job never returns to planning); edit again → approve → back in production
reset role;
select tests.login(tests.user('mgr@a.test'));
select api.reject_jobs(array[(tests.job('โบรชัวร์ Open House')).id], 'ต้องคงขั้นตอนพับ');
select is((tests.job('โบรชัวร์ Open House')).status::text, 'on_hold', 'rejected released job is on hold');

reset role;
select tests.login(tests.user('sup@a.test'));
select api.edit_workflow((tests.job('โบรชัวร์ Open House')).id, tests.flow('โบรชัวร์ Open House'));
reset role;
select tests.login(tests.user('mgr@a.test'));
select is(api.approve_po_plan((tests.job('โบรชัวร์ Open House')).sales_order_id), 1, 'manager approves the new flow');
select is((tests.job('โบรชัวร์ Open House')).status::text, 'in_production', 'released job goes straight back to production');
select is((tests.step('โบรชัวร์ Open House', 'OFFSET')).status::text, 'ready', 'next step is ready again');

-- Rework after a bad print
reset role;
select tests.login(tests.user('sup@a.test'));
select api.start_step((tests.step('โบรชัวร์ Open House', 'OFFSET')).id);
select api.complete_step((tests.step('โบรชัวร์ Open House', 'OFFSET')).id, 6000, 1500, 'สีเพี้ยน');
create temp table t_rw as select api.add_rework_step((tests.step('โบรชัวร์ Open House', 'OFFSET')).id, 1500, 'พิมพ์ซ่อมสีเพี้ยน') as id;
grant select on t_rw to public;
select is((select seq::int from app.job_steps where id = (select id from t_rw)), (tests.step('โบรชัวร์ Open House', 'OFFSET')).seq + 1, 'rework sits right after the printed step');
select is((select status::text from app.job_steps where id = (select id from t_rw)), 'ready', 'rework is ready to run');
select is((tests.step('โบรชัวร์ Open House', 'CUT')).status::text, 'pending', 'cutting waits for the rework');
select ok((select is_rework and rework_reason = 'พิมพ์ซ่อมสีเพี้ยน' from app.job_steps where id = (select id from t_rw)), 'rework is marked with its reason');
select is((tests.job('โบรชัวร์ Open House')).status::text, 'in_production', 'rework needs no re-approval (G-04)');

-- Alternative machines
select ok((select count(*) from api.suggest_machines((select id from t_rw))) >= 1, 'suggestions list capable machines');
select ok((select bool_and(end_at > start_at or est_minutes = 0) from api.suggest_machines((select id from t_rw))), 'each suggestion has a finish time');

select * from finish();
rollback;
