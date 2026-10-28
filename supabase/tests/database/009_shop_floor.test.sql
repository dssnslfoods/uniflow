-- Shop floor actions and machine downtime (FR-6.5/6.6).
begin;
\ir ../helpers/auth.sql
select plan(24);

create temp table t_ctx as select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('staff@a.test'), '{staff}');
select tests.member((select tenant_a from t_ctx), tests.user('exec@a.test'), '{executive}');

-- One released job from the demo seed is enough: the ISB brochure (PLATE → OFFSET → CUT → FOLD → PACK).
select app.seed_demo((select tenant_a from t_ctx), tests.user('owner@a.test'));

create function tests.step(p_job_title text, p_code text) returns app.job_steps language plpgsql as $$
declare r app.job_steps;
begin
  select s.* into r from app.job_steps s join app.jobs j on j.id = s.job_id join app.processes p on p.id = s.process_id
  where j.title = p_job_title and p.code = p_code;
  return r;
end $$;
grant execute on function tests.step(text, text) to authenticated;

select tests.login(tests.user('staff@a.test'));

select throws_ok(format($$ select api.start_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'OFFSET')).id),
                 'P0001', 'step.not_ready', 'a later stage cannot start before the earlier one');

-- PLATE has no machine: staff runs it
select lives_ok(format($$ select api.start_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'PLATE')).id), 'staff starts the first step');
select is((tests.step('โบรชัวร์ Open House', 'PLATE')).status::text, 'in_progress', 'step is running');
select ok((tests.step('โบรชัวร์ Open House', 'PLATE')).actual_start is not null, 'actual start recorded');

select lives_ok(format($$ select api.pause_step(%L, 'พักเที่ยง') $$, (tests.step('โบรชัวร์ Open House', 'PLATE')).id), 'pause');
select is((tests.step('โบรชัวร์ Open House', 'PLATE')).status::text, 'paused', 'step is paused');
select lives_ok(format($$ select api.start_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'PLATE')).id), 'resume');

create temp table t_done as
select api.complete_step((tests.step('โบรชัวร์ Open House', 'PLATE')).id, 4, 0) as r;
grant select on t_done to public;
select is((tests.step('โบรชัวร์ Open House', 'PLATE')).status::text, 'done', 'step done');
select is((tests.step('โบรชัวร์ Open House', 'OFFSET')).status::text, 'ready', 'next stage becomes ready');
select is((select count(*)::int from app.production_logs), 4, 'start, pause, resume, complete logged');

-- Print on SM74 with waste above allowance
select throws_ok(format($$ select api.complete_step(%L, 100, 0) $$, (tests.step('โบรชัวร์ Open House', 'OFFSET')).id),
                 'P0001', 'step.not_running', 'cannot complete a step that never started');
select lives_ok(format($$ select api.start_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'OFFSET')).id), 'start printing');
select throws_ok(format($$ select api.start_step(%L) $$, (tests.step('กล่องครีม 50 ml', 'OFFSET')).id),
                 'P0001', null, 'second job cannot start while the machine is busy');
create temp table t_print as
select api.complete_step((tests.step('โบรชัวร์ Open House', 'OFFSET')).id, 7200, 600, 'สีเพี้ยนช่วงแรก') as r;
grant select on t_print to public;
select ok((select (r ->> 'waste_over')::boolean from t_print), 'waste above allowance is flagged');
select is((select (r ->> 'short_by')::numeric from t_print), (tests.step('โบรชัวร์ Open House', 'OFFSET')).planned_qty - 7200, 'shortfall reported');

-- Downtime on the cutter pushes its queue past the stop
create temp table t_before as select (tests.step('โบรชัวร์ Open House', 'CUT')).planned_start as at;
grant select on t_before to public;
select lives_ok($$ select api.start_downtime((select id from app.machines where code = 'CUT01'), 'breakdown', 240, 'ใบมีดบิ่น') $$,
                'staff reports a breakdown');
select throws_ok($$ select api.start_downtime((select id from app.machines where code = 'CUT01'), 'other') $$,
                 'P0001', 'downtime.already_open', 'one open downtime per machine');
select ok((tests.step('โบรชัวร์ Open House', 'CUT')).planned_start >= now() + interval '239 minutes', 'cut is rescheduled after the expected end');
select throws_ok(format($$ select api.start_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'CUT')).id),
                 'P0001', 'step.machine_down', 'cannot start on a stopped machine');
select lives_ok($$ select api.end_downtime((select id from app.machines where code = 'CUT01')) $$, 'machine back');
select ok((select ended_at is not null from app.machine_downtimes limit 1), 'downtime closed');

-- Finish the remaining steps → job ready to deliver
select api.start_step((tests.step('โบรชัวร์ Open House', 'CUT')).id);
select api.complete_step((tests.step('โบรชัวร์ Open House', 'CUT')).id, 7200, 10);
select api.start_step((tests.step('โบรชัวร์ Open House', 'FOLD')).id);
select api.complete_step((tests.step('โบรชัวร์ Open House', 'FOLD')).id, 14400, 20);
select api.start_step((tests.step('โบรชัวร์ Open House', 'PACK')).id);
select is((select (api.complete_step((tests.step('โบรชัวร์ Open House', 'PACK')).id, 14380, 0) ->> 'job_done')::boolean), true,
          'last step finishes the job');
select is((select status::text from app.jobs where title = 'โบรชัวร์ Open House'), 'ready_to_deliver', 'job is ready to deliver');

reset role;
select tests.login(tests.user('exec@a.test'));
select throws_ok(format($$ select api.start_step(%L) $$, (tests.step('กล่องครีม 50 ml', 'PLATE')).id),
                 'P0001', 'auth.forbidden', 'executives watch, they do not run steps');

select * from finish();
rollback;
