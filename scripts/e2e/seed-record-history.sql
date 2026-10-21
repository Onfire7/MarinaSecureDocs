-- Seeds the LOCAL database for scripts/e2e/record-history.mjs. Never run
-- against a marina's database. Idempotent: removes its own rows first.
--
--   Ticket   "History e2e ticket"   open, medium, unassigned, no Updates.
--   Incident "History e2e incident" open, unassigned, no Addenda or Updates.
--   Template "History e2e" (Manual) with one Verify Task "E2E verify",
--     already open as a checklist assigned to the test account, so a
--     rejection with a ticket is one tap away.
-- The test account holds Security + Admin, which carry assign_ticket_to_self
-- and create_incidents.
do $$
declare
  me       uuid := (select id from users where email = 'gpp@onfire.us');
  role     uuid := (select role_id from user_roles where user_id = me order by role_id limit 1);
  tkt_open uuid := (select id from ticket_statuses   where is_terminal = false order by position, name limit 1);
  inc_open uuid := (select id from incident_statuses where is_terminal = false order by position, name limit 1);
  loc      uuid := (select id from locations order by name limit 1);
  tpl uuid; sec uuid; item uuid; chk uuid; s uuid;
begin
  delete from tickets   where title in ('History e2e ticket') or title like '%E2E verify%';
  delete from incidents where title = 'History e2e incident';
  delete from checklist_instances where template_id in (select id from checklist_templates where name = 'History e2e');
  delete from checklist_templates where name = 'History e2e';

  insert into tickets (title, description, priority, status_id, created_at, created_by_id, location_id)
    values ('History e2e ticket', 'Seeded with no history.', 'medium', tkt_open, now() - interval '1 hour', me, loc);
  insert into incidents (title, details, status_id, created_at, author_id, location_id)
    values ('History e2e incident', 'Seeded with no history.', inc_open, now() - interval '1 hour', me, loc);

  insert into checklist_templates (name, trigger_type, assigned_role_id, assigned_to_user)
    values ('History e2e', 'manual', role, true) returning id into tpl;
  insert into checklist_template_sections (template_id, name, position, trigger_type)
    values (tpl, 'Section', 0, 'manual') returning id into sec;
  insert into checklist_template_items (section_id, type, label, position, config)
    values (sec, 'verify_task', 'E2E verify', 0, '{}') returning id into item;
  insert into checklist_instances (template_id, assigned_to_id, status, started_at, created_at)
    values (tpl, me, 'in_progress', now() - interval '10 minutes', now() - interval '10 minutes') returning id into chk;
  insert into checklist_instance_sections (instance_id, template_section_id, label, position, created_at)
    values (chk, sec, 'Section', 0, now() - interval '10 minutes') returning id into s;
  insert into checklist_instance_items (section_id, template_item_id, position) values (s, item, 0);
end $$;

select refresh_sync_scopes_all();
