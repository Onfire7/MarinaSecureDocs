-- Seeds the LOCAL database for scripts/e2e/checklist-start.mjs. Never run
-- against a marina's database: it ends the test account's shift and switches
-- the role's other Clock In templates to Manual (pnpm run seed restores them).
-- Idempotent.
--
--   Templates "Clock In A e2e" and "Clock In B e2e" (Clock In, the test
--     account's first role, self-assigned), one Always section each holding
--     one Simple Check. No instances. The account is off shift.
do $$
declare
  me   uuid := (select id from users where email = 'gpp@onfire.us');
  role uuid := (select role_id from user_roles where user_id = me order by role_id limit 1);
  tpl  uuid; sec uuid; n text;
begin
  update shifts set ended_at = now() where guard_id = me and ended_at is null;
  delete from checklist_instances where template_id in
    (select id from checklist_templates where name like 'Clock In _ e2e');
  delete from checklist_templates where name like 'Clock In _ e2e';
  delete from checklist_template_items ti
   where ti.label like 'E2E clock in %' and ti.section_id is null
     and not exists (select 1 from checklist_instance_items ii where ii.template_item_id = ti.id);
  -- The role's real Clock In templates would also fire on Start Shift.
  update checklist_templates set trigger_type = 'manual'
   where trigger_type = 'clock_in'
     and assigned_role_id in (select role_id from user_roles where user_id = me);

  foreach n in array array['A', 'B'] loop
    insert into checklist_templates (name, trigger_type, assigned_role_id, assigned_to_user)
      values ('Clock In ' || n || ' e2e', 'clock_in', role, true) returning id into tpl;
    insert into checklist_template_sections (template_id, name, position, trigger_type)
      values (tpl, 'Section ' || n, 0, 'manual') returning id into sec;
    insert into checklist_template_items (section_id, type, label, position)
      values (sec, 'simple_check', 'E2E clock in ' || n, 0);
  end loop;
end $$;

select refresh_sync_scopes_all();
