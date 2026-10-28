-- Members, machine operators, shop settings, notifications and the executive summary.
begin;
\ir ../helpers/auth.sql
select plan(24);

create temp table t_ctx as select tests.tenant(tests.user('owner@a.test'), 'A') as tenant_a;
grant select on t_ctx to public;
select tests.member((select tenant_a from t_ctx), tests.user('mgr@a.test'),    '{manager}');
select tests.member((select tenant_a from t_ctx), tests.user('sup@a.test'),    '{supervisor}');
select tests.member((select tenant_a from t_ctx), tests.user('staff1@a.test'), '{staff}');
select tests.member((select tenant_a from t_ctx), tests.user('staff2@a.test'), '{staff}');
select tests.member((select tenant_a from t_ctx), tests.user('exec@a.test'),   '{executive}');

-- Demo seed by the owner submits DEMO-TFOOD → managers other than the owner are notified.
select app.seed_demo((select tenant_a from t_ctx), tests.user('owner@a.test'));

create function tests.step(p_job_title text, p_code text) returns app.job_steps language plpgsql as $$
declare r app.job_steps;
begin
  select s.* into r from app.job_steps s join app.jobs j on j.id = s.job_id join app.processes p on p.id = s.process_id
  where j.title = p_job_title and p.code = p_code;
  return r;
end $$;
grant execute on function tests.step(text, text) to authenticated;

-- Members ------------------------------------------------------------------------
select tests.login(tests.user('staff1@a.test'));
select is((select count(*)::int from api.list_members()), 6, 'every member listed');
select is((select email from api.list_members() where 'manager' = any (roles) and email like 'mgr%'), 'mgr@a.test', 'emails included');

-- Settings ----------------------------------------------------------------------
select throws_ok($$ select api.update_tenant_settings(null, '{"allow_self_approval": true}') $$, 'P0001', 'auth.forbidden', 'staff cannot change settings');
reset role;
select tests.login(tests.user('owner@a.test'));
select is((api.update_tenant_settings('A Printing', '{"overhead_pct": 12}') ->> 'overhead_pct')::numeric, 12::numeric, 'admin updates a setting');
select is((select name from app.tenants where id = (select tenant_a from t_ctx)), 'A Printing', 'admin renames the shop');
select throws_ok($$ select api.update_tenant_settings(null, '{"plan_id": "business"}') $$, 'P0001', 'Unknown setting: plan_id', 'unknown keys rejected');
select throws_ok($$ select api.update_tenant_settings(null, '{"timezone": "Mars/Base"}') $$, 'P0001', 'settings.invalid_timezone', 'timezone validated');
select throws_ok($$ select api.update_tenant_settings(null, '{"doc_numbering": {"year": "x"}}') $$, 'P0001', 'settings.invalid', 'doc numbering validated');

-- Machine operators ---------------------------------------------------------------
reset role;   -- fixture lookup reads auth.users; tenant claims stay set
insert into app.machine_operators (machine_id, membership_id)
select m.id, mb.id from app.machines m, app.memberships mb join auth.users u on u.id = mb.user_id
where m.code = 'DGT01' and u.email = 'staff1@a.test';

reset role;
select tests.login(tests.user('staff2@a.test'));
select throws_ok(format($$ select api.start_step(%L) $$, (tests.step('นามบัตร 3 แบบ (พิมพ์รวมแผ่น)', 'DIGITAL')).id),
                 'P0001', 'step.not_your_machine', 'unassigned staff cannot run an assigned machine');
select lives_ok(format($$ select api.start_step(%L) $$, (tests.step('โบรชัวร์ Open House', 'PLATE')).id), 'manual steps are open to all staff');

reset role;
select tests.login(tests.user('staff1@a.test'));
select lives_ok(format($$ select api.start_step(%L) $$, (tests.step('นามบัตร 3 แบบ (พิมพ์รวมแผ่น)', 'DIGITAL')).id), 'assigned staff runs the machine');

-- Notifications -------------------------------------------------------------------
reset role;
select tests.login(tests.user('mgr@a.test'));
select is((select count(*)::int from app.notifications where kind = 'approval_requested'), 1, 'one approval alert for a PO with two jobs');
select is((select link from app.notifications where kind = 'approval_requested'), '/approvals', 'alert links to the inbox');

reset role;
select tests.login(tests.user('owner@a.test'));
select is_empty($$ select 1 from app.notifications where kind = 'approval_requested' $$, 'the submitter is not alerted about their own submission');
select api.reject_jobs(array(select id from app.jobs where status = 'pending_approval' limit 1), 'แก้กระดาษ');

reset role;
select tests.login(tests.user('mgr@a.test'));
select api.start_downtime((select id from app.machines where code = 'CUT01'), 'no_material', 60);
reset role;
select tests.login(tests.user('sup@a.test'));
select is((select params ->> 'reason' from app.notifications where kind = 'machine_down'), 'no_material', 'supervisors hear about machine stops');
select is((select count(*)::int from app.notifications where kind = 'approval_requested'), 0, 'supervisors are not asked to approve');
select is(api.mark_notifications_read(), (select count(*)::int from app.notifications where read_at is null) , 'mark all read');
select is_empty($$ select 1 from app.notifications where read_at is null $$, 'nothing unread');

reset role;
select tests.login(tests.user('exec@a.test'));
select is_empty($$ select 1 from app.notifications where kind = 'machine_down' $$, 'executives are not paged for machine stops');

-- Escalation after 24 h
reset role;
update app.approvals set created_at = now() - interval '30 hours' where action = 'submit';
select is(app.escalate_pending_approvals(), 1, 'overdue PO escalates');
select is(app.escalate_pending_approvals(), 0, 'once a day per PO');
select tests.login(tests.user('exec@a.test'));
select is((select count(*)::int from app.notifications where kind = 'approval_overdue'), 1, 'executives see the escalation');

-- Executive summary
select is((api.dashboard_summary() #>> '{counts,in_production}')::int, 4, 'summary counts jobs in production');
select ok(jsonb_array_length(api.dashboard_summary() -> 'machines_down') = 1, 'summary lists machines that are down');

select * from finish();
rollback;
