-- Seeds the LOCAL database for scripts/e2e/checklist-template-update.mjs.
-- Never run against a marina's database. Idempotent: removes its own template,
-- checklists and item rows first.
--
--   Template "Update e2e"
--     Dock (active):   E2E answered · E2E unanswered · E2E removed
--     Shed (inactive): E2E old wording
--   An open checklist with Dock only, "E2E answered" already answered: it
--     matches the template, so no banner shows until the template is edited.
--   A checklist completed 45 days ago, from when Shed was active, reading
--     "E2E old wording". Outside the 30-day window, so no device holds it,
--     which is the whole of test 20.
do $$
declare
  me     uuid := (select id from users where email = 'gpp@onfire.us');
  role   uuid := (select role_id from user_roles where user_id = me order by role_id limit 1);
  tpl    uuid;
  dock   uuid; shed uuid;
  answered uuid; unanswered uuid; removed uuid; old_wording uuid;
  open_chk uuid; old_chk uuid; s uuid;
begin
  delete from checklist_instances
   where template_id in (select id from checklist_templates where name = 'Update e2e');
  delete from checklist_templates where name = 'Update e2e';
  -- Versions orphaned by earlier runs; nothing reads them now.
  delete from checklist_template_items ti
   where ti.label like 'E2E %'
     and not exists (select 1 from checklist_instance_items ii where ii.template_item_id = ti.id);
  -- A new item is called "Simple Check" until the run renames it.
  delete from checklist_template_items ti
   where ti.label = 'Simple Check' and ti.section_id is null
     and not exists (select 1 from checklist_instance_items ii where ii.template_item_id = ti.id);

  insert into checklist_templates (name, trigger_type, assigned_role_id)
    values ('Update e2e', 'manual', role) returning id into tpl;
  insert into checklist_template_sections (template_id, name, position)
    values (tpl, 'Dock', 0) returning id into dock;
  insert into checklist_template_sections (template_id, name, position, is_active)
    values (tpl, 'Shed', 1, false) returning id into shed;
  insert into checklist_template_items (section_id, type, label, position)
    values (dock, 'simple_check', 'E2E answered', 0) returning id into answered;
  insert into checklist_template_items (section_id, type, label, position)
    values (dock, 'simple_check', 'E2E unanswered', 1) returning id into unanswered;
  insert into checklist_template_items (section_id, type, label, position)
    values (dock, 'simple_check', 'E2E removed', 2) returning id into removed;
  insert into checklist_template_items (section_id, type, label, position)
    values (shed, 'simple_check', 'E2E old wording', 0) returning id into old_wording;

  insert into checklist_instances (template_id, assigned_to_id, status, started_at, created_at)
    values (tpl, me, 'in_progress', now() - interval '1 hour', now() - interval '1 hour')
    returning id into open_chk;
  insert into checklist_instance_sections (instance_id, template_section_id, label, position, created_at)
    values (open_chk, dock, 'Dock', 0, now() - interval '1 hour') returning id into s;
  insert into checklist_instance_items (section_id, template_item_id, position, completed_at, completed_by_id, result)
    values (s, answered, 0, now() - interval '30 minutes', me, '{"type":"simple_check"}');
  insert into checklist_instance_items (section_id, template_item_id, position) values
    (s, unanswered, 1),
    (s, removed, 2);

  insert into checklist_instances (template_id, assigned_to_id, status, started_at, completed_at)
    values (tpl, me, 'complete', now() - interval '45 days', now() - interval '45 days')
    returning id into old_chk;
  insert into checklist_instance_sections (instance_id, template_section_id, label, position)
    values (old_chk, shed, 'Shed', 0) returning id into s;
  insert into checklist_instance_items (section_id, template_item_id, position, completed_at, completed_by_id, result)
    values (s, old_wording, 0, now() - interval '45 days', me, '{"type":"simple_check"}');
end $$;

-- New rows default to in scope; this is what takes the old checklist out.
select refresh_sync_scopes_all();
