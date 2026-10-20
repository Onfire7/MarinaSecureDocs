-- Seeds the LOCAL database for scripts/e2e/end-shift.mjs. Never run against a
-- marina's database: it rewrites configuration (see "Other Clock Out
-- templates" below) and creates and ends shifts for the test account.
--
-- Defines e2e_end_shift_reset(clock_out, on_shift, spare), which the script
-- calls before each scenario, and runs it once with everything on.
--
--   Template "Evening Lockup e2e" (Manual), section Lockup (Always):
--     E2E done · E2E todo · End Shift
--   Template "Closing e2e" (Clock Out), section Closing (Always):
--     E2E closing item. Its section is switched off when clock_out is false,
--     so the template has nothing to do and no End of Shift Checklist is due.
--   Template "Spare e2e" (Manual), section Spare (Always): E2E spare item.
--   Templates "Editor e2e" (Manual) and "Editor clock out e2e" (Clock Out),
--     for the template-editor test; reset to one Simple Check each.
--
--   Each reset ends any open shift of the test account, then, when on_shift,
--   starts one an hour ago. It opens a fresh Evening Lockup e2e with "E2E
--   done" answered, created 30 minutes ago - inside the shift - and, when
--   spare, a fresh open Spare e2e.
--
-- Other Clock Out templates. The real exported configuration may give the
-- test account's role a Clock Out template of its own, and the Shift card
-- would pick that one. Every other Clock Out template for the account's roles
-- is switched to Manual here. Re-seed (pnpm run seed) to restore them.

create or replace function e2e_end_shift_reset(clock_out boolean, on_shift boolean, spare boolean)
returns void language plpgsql as $$
declare
  me     uuid := (select id from users where email = 'gpp@onfire.us');
  role   uuid := (select role_id from user_roles where user_id = me order by role_id limit 1);
  t_eve  uuid; t_close uuid; t_spare uuid; t_ed uuid; t_edco uuid;
  s_eve  uuid; s_close uuid; s_spare uuid; s_ed uuid; s_edco uuid;
  i_done uuid; i_todo uuid; i_end uuid; i_spare uuid;
  chk uuid; s uuid;
begin
  update checklist_templates set trigger_type = 'manual'
   where trigger_type = 'clock_out'
     and assigned_role_id in (select role_id from user_roles where user_id = me)
     and name not like '% e2e';

  delete from checklist_instances
   where template_id in (select id from checklist_templates where name like '% e2e');
  update shifts set end_of_shift_checklist_id = null
   where guard_id = me and end_of_shift_checklist_id is not null;
  delete from checklist_templates where name like '% e2e';
  delete from checklist_template_items ti
   where ti.label like 'E2E %' and ti.section_id is null
     and not exists (select 1 from checklist_instance_items ii where ii.template_item_id = ti.id);

  insert into checklist_templates (name, trigger_type, assigned_role_id, assigned_to_user)
    values ('Evening Lockup e2e', 'manual', role, true) returning id into t_eve;
  insert into checklist_template_sections (template_id, name, position, trigger_type)
    values (t_eve, 'Lockup', 0, 'manual') returning id into s_eve;
  insert into checklist_template_items (section_id, type, label, position)
    values (s_eve, 'simple_check', 'E2E done', 0) returning id into i_done;
  insert into checklist_template_items (section_id, type, label, position)
    values (s_eve, 'simple_check', 'E2E todo', 1) returning id into i_todo;
  insert into checklist_template_items (section_id, type, label, position)
    values (s_eve, 'end_shift', 'End Shift', 2) returning id into i_end;

  insert into checklist_templates (name, trigger_type, assigned_role_id, assigned_to_user)
    values ('Closing e2e', 'clock_out', role, true) returning id into t_close;
  insert into checklist_template_sections (template_id, name, position, trigger_type, is_active)
    values (t_close, 'Closing', 0, 'manual', clock_out) returning id into s_close;
  insert into checklist_template_items (section_id, type, label, position)
    values (s_close, 'simple_check', 'E2E closing item', 0);

  insert into checklist_templates (name, trigger_type, assigned_role_id, assigned_to_user)
    values ('Spare e2e', 'manual', role, true) returning id into t_spare;
  insert into checklist_template_sections (template_id, name, position, trigger_type)
    values (t_spare, 'Spare', 0, 'manual') returning id into s_spare;
  insert into checklist_template_items (section_id, type, label, position)
    values (s_spare, 'simple_check', 'E2E spare item', 0) returning id into i_spare;

  insert into checklist_templates (name, trigger_type, assigned_role_id)
    values ('Editor e2e', 'manual', role) returning id into t_ed;
  insert into checklist_template_sections (template_id, name, position, trigger_type)
    values (t_ed, 'Editor section', 0, 'manual') returning id into s_ed;
  insert into checklist_template_items (section_id, type, label, position)
    values (s_ed, 'simple_check', 'E2E editor item', 0);
  insert into checklist_templates (name, trigger_type, assigned_role_id)
    values ('Editor clock out e2e', 'clock_out', role) returning id into t_edco;
  insert into checklist_template_sections (template_id, name, position, trigger_type)
    values (t_edco, 'Editor section', 0, 'manual') returning id into s_edco;
  insert into checklist_template_items (section_id, type, label, position)
    values (s_edco, 'simple_check', 'E2E editor clock out item', 0);

  update shifts set ended_at = now() - interval '2 hours'
   where guard_id = me and ended_at is null;
  if on_shift then
    insert into shifts (guard_id, started_at) values (me, now() - interval '1 hour');
  end if;

  insert into checklist_instances (template_id, assigned_to_id, status, started_at, created_at)
    values (t_eve, me, 'in_progress', now() - interval '30 minutes', now() - interval '30 minutes')
    returning id into chk;
  insert into checklist_instance_sections (instance_id, template_section_id, label, position, created_at)
    values (chk, s_eve, 'Lockup', 0, now() - interval '30 minutes') returning id into s;
  insert into checklist_instance_items (section_id, template_item_id, position, completed_at, completed_by_id, result)
    values (s, i_done, 0, now() - interval '20 minutes', me, '{"type":"simple_check"}');
  insert into checklist_instance_items (section_id, template_item_id, position) values
    (s, i_todo, 1),
    (s, i_end, 2);

  if spare then
    insert into checklist_instances (template_id, assigned_to_id, status, created_at)
      values (t_spare, me, 'not_started', now() - interval '25 minutes') returning id into chk;
    insert into checklist_instance_sections (instance_id, template_section_id, label, position, created_at)
      values (chk, s_spare, 'Spare', 0, now() - interval '25 minutes') returning id into s;
    insert into checklist_instance_items (section_id, template_item_id, position) values (s, i_spare, 0);
  end if;

  perform refresh_sync_scopes_all();
end $$;

select e2e_end_shift_reset(true, true, true);
