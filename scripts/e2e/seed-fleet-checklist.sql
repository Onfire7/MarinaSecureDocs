-- Seeds the LOCAL database for scripts/e2e/fleet-checklist.mjs. Never run
-- against a marina's database. Run scripts/e2e/seed-fleet-card.sql first:
-- this builds on its vehicles, people and e2e_fleet_reset().
--
-- Defines e2e_fleet_item_reset(holding), which the script calls before each
-- scenario:
--
--   e2e_fleet_reset(true, '{}') — the Fleet card's vehicles: Truck e2e
--   (available, 1000 mi), Mine e2e (checked out to the test account), Van e2e
--   (with Dana e2e), Cart e2e (out of service). When not `holding`, Mine e2e's
--   checkout is closed, so the test account holds nothing.
--
--   Templates, all assigned to the test account's first role:
--     "Fleet Patrol e2e" (manual, assigned to whoever triggers it)
--        section "Patrol" (Always): "E2E patrol check" (simple),
--          "Take a vehicle" (fleet_vehicle, take),
--          "Vehicle status check" (fleet_vehicle, status),
--          "Return your vehicle" (fleet_vehicle, return)
--        section "Walkaround e2e" (Asset checked out, Truck e2e):
--          "E2E walkaround" (simple)
--     "Vehicle Return e2e" (Asset Check Out/In)
--        section "Return walkaround" (Asset checked in, Truck e2e):
--          "E2E return walkaround" (simple)
--     "Fleet Editor e2e" (manual), one Always section, one simple item, for
--        the template editor test.
--   One open "Fleet Patrol e2e" checklist for the test account, created 30
--   minutes ago, holding the Patrol section only.
--
--   Shifts: any open shift of the test account is ended two hours ago, and a
--   new one starts an hour ago.

create or replace function e2e_fleet_item_reset(holding boolean)
returns void language plpgsql as $$
declare
  me    uuid := (select id from users where email = 'gpp@onfire.us');
  role  uuid := (select role_id from user_roles where user_id = me order by role_id limit 1);
  truck uuid;
  t_patrol uuid; t_return uuid; t_ed uuid;
  s_patrol uuid; s_walk uuid; s_ret uuid; s_ed uuid;
  i_check uuid; i_take uuid; i_status uuid; i_return uuid;
  chk uuid; s uuid;
begin
  -- Checklists first: their items may name checkouts the vehicle reset deletes.
  delete from checklist_instances
   where template_id in (select id from checklist_templates where name like '% e2e');
  delete from checklist_templates where name like '% e2e';
  delete from checklist_template_items ti
   where ti.label like 'E2E %' and ti.section_id is null
     and not exists (select 1 from checklist_instance_items ii where ii.template_item_id = ti.id);

  perform e2e_fleet_reset(true, '{}');
  truck := (select id from assets where name = 'Truck e2e');
  if not holding then
    update asset_checkouts set time_in = now() - interval '30 minutes', odometer_in = 2015, fuel_level_in = 3
     where asset_id = (select id from assets where name = 'Mine e2e') and time_in is null;
  end if;

  -- ── templates ──────────────────────────────────────────────────────────
  insert into checklist_templates (name, trigger_type, assigned_role_id, assigned_to_user)
    values ('Fleet Patrol e2e', 'manual', role, true) returning id into t_patrol;
  insert into checklist_template_sections (template_id, name, position, trigger_type)
    values (t_patrol, 'Patrol', 0, 'manual') returning id into s_patrol;
  insert into checklist_template_items (section_id, type, label, position, config) values
    (s_patrol, 'simple_check', 'E2E patrol check', 0, null)
    returning id into i_check;
  insert into checklist_template_items (section_id, type, label, position, config) values
    (s_patrol, 'fleet_vehicle', 'Take a vehicle', 1, '{"mode":"take"}') returning id into i_take;
  insert into checklist_template_items (section_id, type, label, position, config) values
    (s_patrol, 'fleet_vehicle', 'Vehicle status check', 2, '{"mode":"status"}') returning id into i_status;
  insert into checklist_template_items (section_id, type, label, position, config) values
    (s_patrol, 'fleet_vehicle', 'Return your vehicle', 3, '{"mode":"return"}') returning id into i_return;
  insert into checklist_template_sections (template_id, name, position, trigger_type, trigger_config)
    values (t_patrol, 'Walkaround e2e', 1, 'asset', '{"event":"check_out"}') returning id into s_walk;
  insert into template_section_assets (section_id, asset_id) values (s_walk, truck);
  insert into checklist_template_items (section_id, type, label, position)
    values (s_walk, 'simple_check', 'E2E walkaround', 0);

  insert into checklist_templates (name, trigger_type, assigned_role_id, assigned_to_user)
    values ('Vehicle Return e2e', 'asset', role, true) returning id into t_return;
  insert into checklist_template_sections (template_id, name, position, trigger_type, trigger_config)
    values (t_return, 'Return walkaround', 0, 'asset', '{"event":"check_in"}') returning id into s_ret;
  insert into template_section_assets (section_id, asset_id) values (s_ret, truck);
  insert into checklist_template_items (section_id, type, label, position)
    values (s_ret, 'simple_check', 'E2E return walkaround', 0);

  insert into checklist_templates (name, trigger_type, assigned_role_id)
    values ('Fleet Editor e2e', 'manual', role) returning id into t_ed;
  insert into checklist_template_sections (template_id, name, position, trigger_type)
    values (t_ed, 'Editor section', 0, 'manual') returning id into s_ed;
  insert into checklist_template_items (section_id, type, label, position)
    values (s_ed, 'simple_check', 'E2E editor item', 0);

  -- ── shift and the open checklist ───────────────────────────────────────
  update shifts set ended_at = now() - interval '2 hours'
   where guard_id = me and ended_at is null;
  insert into shifts (guard_id, started_at) values (me, now() - interval '1 hour');

  insert into checklist_instances (template_id, assigned_to_id, status, started_at, created_at)
    values (t_patrol, me, 'in_progress', now() - interval '30 minutes', now() - interval '30 minutes')
    returning id into chk;
  insert into checklist_instance_sections (instance_id, template_section_id, label, position, created_at)
    values (chk, s_patrol, 'Patrol', 0, now() - interval '30 minutes') returning id into s;
  insert into checklist_instance_items (section_id, template_item_id, position) values
    (s, i_check, 0), (s, i_take, 1), (s, i_status, 2), (s, i_return, 3);

  perform refresh_sync_scopes_all();
end $$;

select e2e_fleet_item_reset(false);
