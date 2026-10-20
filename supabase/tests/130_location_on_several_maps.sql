-- A location on several maps (docs/maps.md § A location on several maps;
-- tests approved 2026-10-19). Placing it on another map adds it there, and
-- an audit may carry one move_placement Proposal per map.
create extension if not exists pgtap;
begin;
select plan(5);

insert into users (id, name, clerk_user_id, active) values
  ('11111111-0000-4000-8000-0000000013a1', 'Alice — audits + locations', 'user_alice_multimap', true);
insert into roles (id, name, allow) values
  ('aaaa0000-0000-4000-8000-0000000013a1', 'Multimap Fixture Full', array['manage_audits','manage_locations']);
insert into user_roles (user_id, role_id) values
  ('11111111-0000-4000-8000-0000000013a1','aaaa0000-0000-4000-8000-0000000013a1');

insert into location_types (id, name) values ('cccc0000-0000-4000-8000-0000000013a1','Multimap Fixture Type');
insert into locations (id, name, location_type_id, parent_id) values
  ('dddd0000-0000-4000-8000-0000000013a1','MM Marina','cccc0000-0000-4000-8000-0000000013a1', null);
insert into locations (id, name, location_type_id, parent_id) values
  ('dddd0000-0000-4000-8000-0000000013a2','MM Dock','cccc0000-0000-4000-8000-0000000013a1','dddd0000-0000-4000-8000-0000000013a1');
insert into locations (id, name, location_type_id, parent_id) values
  ('dddd0000-0000-4000-8000-0000000013a3','MM Slip','cccc0000-0000-4000-8000-0000000013a1','dddd0000-0000-4000-8000-0000000013a2'),
  ('dddd0000-0000-4000-8000-0000000013a4','MM Slip 2','cccc0000-0000-4000-8000-0000000013a1','dddd0000-0000-4000-8000-0000000013a2');
insert into marina_maps (id, name, scope_id) values
  ('eeee0000-0000-4000-8000-0000000013a1','MM Overview','dddd0000-0000-4000-8000-0000000013a1'),
  ('eeee0000-0000-4000-8000-0000000013a2','MM Dock Map','dddd0000-0000-4000-8000-0000000013a2'),
  ('eeee0000-0000-4000-8000-0000000013a3','MM Third Map','dddd0000-0000-4000-8000-0000000013a1');

-- ── D1: placing on a second map adds it there ───────────────────────────
insert into map_anchors (map_id, location_id, cx, cy) values
  ('eeee0000-0000-4000-8000-0000000013a1','dddd0000-0000-4000-8000-0000000013a3', 10, 10);
insert into map_labels (map_id, location_id, cx, cy) values
  ('eeee0000-0000-4000-8000-0000000013a1','dddd0000-0000-4000-8000-0000000013a3', 12, 12);
select apply_map_placement('eeee0000-0000-4000-8000-0000000013a2','dddd0000-0000-4000-8000-0000000013a3',
  '{"map_id":"eeee0000-0000-4000-8000-0000000013a2","anchor":{"cx":50,"cy":50},"label":{"cx":52,"cy":52,"rotation":0}}'::jsonb);
select is((select count(*)::int from map_anchors where location_id = 'dddd0000-0000-4000-8000-0000000013a3')
        + (select count(*)::int from map_labels where location_id = 'dddd0000-0000-4000-8000-0000000013a3'), 4,
  'D1 · placing a location on a second map adds an anchor and a label there');
select is((select cx::int || ',' || cy::int from map_anchors where map_id = 'eeee0000-0000-4000-8000-0000000013a1' and location_id = 'dddd0000-0000-4000-8000-0000000013a3'), '10,10',
  'D1 · and the first map''s anchor and label are left where they were');

-- ── D2: one finding, a change on each of two maps, both applied ──────────
insert into audits (id, name, kind, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000013b1','Multimap Audit','status','11111111-0000-4000-8000-0000000013a1');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee1111-0000-4000-8000-0000000013b1','eeee0000-0000-4000-8000-0000000013b1','dddd0000-0000-4000-8000-0000000013a4','MM Slip 2',0);
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at, mapped_correctly) values
  ('ffff0000-0000-4000-8000-0000000013b1','eeee0000-0000-4000-8000-0000000013b1','eeee1111-0000-4000-8000-0000000013b1','11111111-0000-4000-8000-0000000013a1', now(), false);
insert into audit_proposals (id, finding_id, kind, payload) values
  ('99990000-0000-4000-8000-0000000013b1','ffff0000-0000-4000-8000-0000000013b1','move_placement',
     '{"map_id":"eeee0000-0000-4000-8000-0000000013a2","anchor":{"cx":30,"cy":30},"label":{"cx":32,"cy":32,"rotation":0}}'),
  ('99990000-0000-4000-8000-0000000013b2','ffff0000-0000-4000-8000-0000000013b1','move_placement',
     '{"map_id":"eeee0000-0000-4000-8000-0000000013a3","anchor":{"cx":70,"cy":70},"label":null}');
select set_config('request.jwt.claims', '{"sub":"user_alice_multimap"}', true);
set local role authenticated;
update audit_proposals set decision = 'approved', decided_by_id = '11111111-0000-4000-8000-0000000013a1'
 where finding_id = 'ffff0000-0000-4000-8000-0000000013b1';
select lives_ok($$select finalize_audit('eeee0000-0000-4000-8000-0000000013b1')$$,
  'D2 · an audit with a map change on each of two maps finalizes');
reset role;
select is((select string_agg(m.name, ', ' order by m.name) from map_anchors a join marina_maps m on m.id = a.map_id
            where a.location_id = 'dddd0000-0000-4000-8000-0000000013a4'), 'MM Dock Map, MM Third Map',
  'D2 · both maps carry the location''s anchor');
select is((select count(*)::int from map_labels where location_id = 'dddd0000-0000-4000-8000-0000000013a4'), 1,
  'D2 · and the label goes only where one was proposed');

select * from finish();
rollback;
