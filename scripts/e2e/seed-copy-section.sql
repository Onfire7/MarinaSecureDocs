-- Seeds the LOCAL database for scripts/e2e/copy-section.mjs.
-- Never run against a marina's database. Idempotent: removes its own rows first.
--
--   Locations: "Copy Dock e2e" (Dock) with four slips, "Copy Slip 1..4 e2e".
--   Template "Copy e2e"
--     "Copy Slip 1 e2e walk" at Slip 1: a Door Check pointing at Slip 1 and a
--       Simple Check "Copy Slip 1 e2e gate"; checkpoint "Copy Slip 1 e2e gate
--       tag" attached.
--     "Slip 4" at Slip 4: already in the template, so the copy must skip it.
do $$
declare
  dock_type uuid; slip_type uuid;
  dock uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  tpl uuid; src uuid; cp uuid;
  role uuid := (select role_id from user_roles ur join users u on u.id = ur.user_id
                 where u.email = 'gpp@onfire.us' order by role_id limit 1);
begin
  delete from checklist_templates where name = 'Copy e2e';
  delete from checklist_template_items ti
   where ti.label like 'Copy Slip % e2e%' and ti.section_id is null
     and not exists (select 1 from checklist_instance_items ii where ii.template_item_id = ti.id);
  delete from checkpoints where name like 'Copy Slip % e2e%';
  delete from locations where name like 'Copy Slip % e2e';
  delete from locations where name = 'Copy Dock e2e';

  select id into dock_type from location_types where name = 'Dock' limit 1;
  if dock_type is null then
    insert into location_types (name) values ('Dock') returning id into dock_type;
  end if;
  select id into slip_type from location_types where name = 'Slip' limit 1;
  if slip_type is null then
    insert into location_types (name) values ('Slip') returning id into slip_type;
  end if;

  insert into locations (name, location_type_id) values ('Copy Dock e2e', dock_type) returning id into dock;
  insert into locations (name, location_type_id, parent_id) values ('Copy Slip 1 e2e', slip_type, dock) returning id into s1;
  insert into locations (name, location_type_id, parent_id) values ('Copy Slip 2 e2e', slip_type, dock) returning id into s2;
  insert into locations (name, location_type_id, parent_id) values ('Copy Slip 3 e2e', slip_type, dock) returning id into s3;
  insert into locations (name, location_type_id, parent_id) values ('Copy Slip 4 e2e', slip_type, dock) returning id into s4;

  insert into checkpoints (name, guid_url, location_id, gps_validation_radius)
    values ('Copy Slip 1 e2e gate tag', 'copy-slip-1-e2e', s1, 25) returning id into cp;

  insert into checklist_templates (name, trigger_type, assigned_role_id)
    values ('Copy e2e', 'manual', role) returning id into tpl;
  insert into checklist_template_sections (template_id, name, position, location_id)
    values (tpl, 'Copy Slip 1 e2e walk', 0, s1) returning id into src;
  insert into checklist_template_sections (template_id, name, position, location_id)
    values (tpl, 'Slip 4', 1, s4);
  insert into checklist_template_items (section_id, type, label, position, config)
    values (src, 'door_check', 'Copy Slip 1 e2e door', 0, jsonb_build_object('locationId', s1));
  insert into checklist_template_items (section_id, type, label, position)
    values (src, 'simple_check', 'Copy Slip 1 e2e gate', 1);
  insert into template_section_checkpoints (section_id, checkpoint_id) values (src, cp);
end $$;

select refresh_sync_scopes_all();
