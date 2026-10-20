-- Seeds the LOCAL database for scripts/e2e/location-maps.mjs: one location
-- on two maps - its dock's and the overview - a third map it is not on, and
-- an open status audit that asks only about the map. Never run against a
-- marina's database. Idempotent: drops its own audit and maps first.
do $$
declare
  me     uuid := (select id from users where active order by name limit 1);
  slip   record;
  root   uuid;
  img    uuid := (select image_attachment_id from marina_maps where image_attachment_id is not null limit 1);
  dock_m uuid; over_m uuid; third_m uuid;
  a      uuid;
begin
  delete from audits where name = 'Maps e2e';
  delete from marina_maps where name in ('E2E Dock Map', 'E2E Overview', 'E2E Third Map');

  -- A location two levels down, so it has a dock (its parent) and a root.
  select l.id, l.name, l.parent_id into slip
    from locations l join locations p on p.id = l.parent_id
   where l.retired_at is null and p.parent_id is not null
   order by l.name limit 1;
  with recursive up as (
    select id, parent_id from locations where id = slip.parent_id
    union all
    select l.id, l.parent_id from locations l join up on l.id = up.parent_id
  ) select id into root from up where parent_id is null;

  insert into marina_maps (name, scope_id, image_attachment_id) values ('E2E Dock Map', slip.parent_id, img) returning id into dock_m;
  insert into marina_maps (name, scope_id, image_attachment_id) values ('E2E Overview', root, img) returning id into over_m;
  insert into marina_maps (name, scope_id, image_attachment_id) values ('E2E Third Map', root, img) returning id into third_m;

  -- Only on our two maps, so the default is decided by this fixture.
  delete from map_anchors where location_id = slip.id;
  delete from map_labels  where location_id = slip.id;
  insert into map_anchors (map_id, location_id, cx, cy) values (dock_m, slip.id, 40, 40), (over_m, slip.id, 60, 60);
  insert into map_labels  (map_id, location_id, cx, cy) values (dock_m, slip.id, 42, 42), (over_m, slip.id, 62, 62);

  insert into audits (name, kind, launched_by_id, include_attributes, include_services, include_amenities, include_marked, include_map)
    values ('Maps e2e', 'status', me, false, false, false, false, true)
    returning id into a;
  insert into audit_assignees (audit_id, user_id) values (a, me);
  insert into audit_rules (audit_id, position, mode, conditions) values (a, 0, 'all', '[]');
  insert into audit_targets (audit_id, location_id, location_name, position) values (a, slip.id, slip.name, 0);
  raise notice 'audit % on %', a, slip.name;
end $$;
select a.id, t.location_name from audits a join audit_targets t on t.audit_id = a.id where a.name = 'Maps e2e';
