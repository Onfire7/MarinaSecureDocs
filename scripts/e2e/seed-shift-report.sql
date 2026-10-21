-- Seeds the LOCAL database for scripts/e2e/shift-report.mjs. Never run
-- against a marina's database: it ends the test account's shifts and
-- creates checkpoints, assets and work records in its name.
--
-- Defines e2e_shift_report_reset(fresh boolean), which the script calls
-- before each scenario, and runs it once with fresh = false:
--
--   An active shift of the test account, started 2 hours ago.
--   Location "Report Dock e2e" with checkpoints "Report CP A e2e" (visited
--     90 minutes ago) and "Report CP B e2e" (never visited).
--   Template "Report Walk e2e" (Manual), one section bound to that location
--     naming both checkpoints, with items: a Simple Check (done), a Door
--     Check "Report door e2e" (found Unlocked, expected Locked, left Locked).
--     Open as a checklist of the test account, created 100 minutes ago.
--   Incident "Report incident e2e" and ticket "Report ticket e2e" by the
--     guard, 80 and 70 minutes ago, on the location.
--   Fleet Vehicle "Report Truck e2e": checked out 110 minutes ago, back 20
--     minutes ago (48000 → 48042, fuel ½, note "Mud on the seats").
--   fresh = true: the same, but a bare shift started 5 minutes ago with
--     nothing in it, and every record above removed.
create or replace function e2e_shift_report_reset(fresh boolean)
returns void language plpgsql as $$
declare
  me       uuid := (select id from users where email = 'gpp@onfire.us');
  my_contact uuid;
  role     uuid := (select role_id from user_roles where user_id = me order by role_id limit 1);
  tkt_open uuid := (select id from ticket_statuses   where is_terminal = false order by position, name limit 1);
  inc_open uuid := (select id from incident_statuses where is_terminal = false order by position, name limit 1);
  ltype    uuid := (select id from location_types order by name limit 1);
  loc uuid; cpa uuid; cpb uuid; tpl uuid; sec uuid; i_simple uuid; i_door uuid; chk uuid; s uuid; truck uuid; shift uuid;
  t0 timestamptz := now() - interval '2 hours';
begin
  my_contact := (select contact_id from users where id = me);
  if my_contact is null then
    insert into contacts (name) values ('Me e2e') returning id into my_contact;
    update users set contact_id = my_contact where id = me;
  end if;

  delete from shift_report_snapshots where shift_id in (select id from shifts where guard_id = me);
  update shifts set ended_at = coalesce(ended_at, now()) where guard_id = me and ended_at is null;
  delete from incidents where title = 'Report incident e2e';
  delete from tickets where title = 'Report ticket e2e';
  delete from checklist_instances where template_id in (select id from checklist_templates where name = 'Report Walk e2e');
  delete from checklist_templates where name = 'Report Walk e2e';
  delete from check_ins where checkpoint_id in (select id from checkpoints where name like 'Report CP % e2e');
  delete from checkpoints where name like 'Report CP % e2e';
  delete from asset_checkouts where asset_id in (select id from assets where name = 'Report Truck e2e');
  delete from asset_meter_readings where asset_id in (select id from assets where name = 'Report Truck e2e');
  delete from assets where name = 'Report Truck e2e';
  delete from locations where name = 'Report Dock e2e';

  if fresh then
    insert into shifts (guard_id, started_at) values (me, now() - interval '5 minutes');
    perform refresh_sync_scopes_all();
    return;
  end if;

  insert into shifts (guard_id, started_at) values (me, t0) returning id into shift;
  insert into locations (name, location_type_id) values ('Report Dock e2e', ltype) returning id into loc;
  insert into checkpoints (name, guid_url, location_id) values ('Report CP A e2e', 'report-cp-a-e2e', loc) returning id into cpa;
  insert into checkpoints (name, guid_url, location_id) values ('Report CP B e2e', 'report-cp-b-e2e', loc) returning id into cpb;
  insert into check_ins (checkpoint_id, user_id, timestamp, method, within_radius)
    values (cpa, me, t0 + interval '30 minutes', 'scanned', true);

  insert into checklist_templates (name, trigger_type, assigned_role_id, assigned_to_user)
    values ('Report Walk e2e', 'manual', role, true) returning id into tpl;
  insert into checklist_template_sections (template_id, name, position, trigger_type, location_id)
    values (tpl, 'Dock', 0, 'manual', loc) returning id into sec;
  insert into template_section_checkpoints (section_id, checkpoint_id) values (sec, cpa), (sec, cpb);
  insert into checklist_template_items (section_id, type, label, position)
    values (sec, 'simple_check', 'Report cords e2e', 0) returning id into i_simple;
  insert into checklist_template_items (section_id, type, label, position, config)
    values (sec, 'door_check', 'Report door e2e', 1, jsonb_build_object('expected', 'locked', 'locationId', loc)) returning id into i_door;
  insert into checklist_instances (template_id, assigned_to_id, status, started_at, created_at)
    values (tpl, me, 'in_progress', t0 + interval '20 minutes', t0 + interval '20 minutes') returning id into chk;
  insert into checklist_instance_sections (instance_id, template_section_id, label, position, location_id, created_at)
    values (chk, sec, 'Dock', 0, loc, t0 + interval '20 minutes') returning id into s;
  insert into checklist_instance_items (section_id, template_item_id, position, completed_at, completed_by_id, result) values
    (s, i_simple, 0, t0 + interval '35 minutes', me, '{"type":"simple_check","completedAt":1}'),
    (s, i_door, 1, t0 + interval '40 minutes', me, '{"type":"door_check","expected":"locked","initialState":"unlocked","finalState":"locked"}');

  insert into incidents (title, details, status_id, created_at, author_id, location_id)
    values ('Report incident e2e', 'Caught the gate post backing out.', inc_open, t0 + interval '40 minutes', me, loc);
  insert into tickets (title, status_id, priority, created_at, created_by_id, location_id)
    values ('Report ticket e2e', tkt_open, 'medium', t0 + interval '50 minutes', me, loc);

  insert into assets (name, category, has_meter, meter_type, meter_reading, checkoutable, is_fleet)
    values ('Report Truck e2e', 'Vehicles', true, 'mileage', 48042, true, true) returning id into truck;
  insert into asset_checkouts (asset_id, person_id, checked_out_by_id, time_out, time_in, odometer_out, odometer_in, fuel_level_in, return_note)
    values (truck, my_contact, me, t0 + interval '10 minutes', t0 + interval '100 minutes', 48000, 48042, 2, 'Mud on the seats');

  perform refresh_sync_scopes_all();
end $$;

select e2e_shift_report_reset(false);
