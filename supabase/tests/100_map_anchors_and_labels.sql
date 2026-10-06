-- Anchors and labels (docs/maps.md; migration 20261005000100).
--
-- Both halves of every permission check run: a user with manage_locations
-- and one without. Denial alone proves nothing (CLAUDE.md).
create extension if not exists pgtap;
begin;
select plan(14);

-- ── fixtures (as owner) ──────────────────────────────────────────────────
insert into users (id, name, clerk_user_id, active) values
  ('11111111-1111-1111-1111-1111111100a1', 'Alice — manages locations', 'user_alice_maps', true),
  ('22222222-2222-2222-2222-2222222200a1', 'Bob — no roles',             'user_bob_maps',   true);
insert into roles (id, name, allow) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Map Fixture Manager', array['manage_locations']);
insert into user_roles values ('11111111-1111-1111-1111-1111111100a1','aaaaaaaa-0000-0000-0000-0000000000a1');

insert into location_types (id, name) values ('cccccccc-0000-0000-0000-0000000000a1','Map Fixture Slip');
insert into locations (id, name, location_type_id, gps_lat, gps_lng) values
  ('dddddddd-0000-0000-0000-0000000000a1','Map Fixture Dock','cccccccc-0000-0000-0000-0000000000a1', null, null),
  ('dddddddd-0000-0000-0000-0000000000a2','Map Fixture Slip 1','cccccccc-0000-0000-0000-0000000000a1', 33.85, -96.64),
  ('dddddddd-0000-0000-0000-0000000000a3','Map Fixture Slip 2','cccccccc-0000-0000-0000-0000000000a1', null, null);
insert into marina_maps (id, name, scope_id) values ('eeeeeeee-0000-0000-0000-0000000000a1','Map Fixture','dddddddd-0000-0000-0000-0000000000a1');
insert into map_anchors (id, map_id, location_id, cx, cy, lat, lng) values
  ('f0000000-0000-0000-0000-0000000000a1','eeeeeeee-0000-0000-0000-0000000000a1','dddddddd-0000-0000-0000-0000000000a2', 20, 30, 33.85, -96.64);
insert into map_labels (map_id, location_id, cx, cy, rotation, font_size) values
  ('eeeeeeee-0000-0000-0000-0000000000a1','dddddddd-0000-0000-0000-0000000000a2', 24, 28, -42, 4);

-- ── read for everyone, write with manage_locations ──────────────────────
select set_config('request.jwt.claims', '{"sub":"user_bob_maps"}', true);
set local role authenticated;
select is((select count(*) from map_anchors where map_id = 'eeeeeeee-0000-0000-0000-0000000000a1')::int, 1,
  'a user without manage_locations reads the anchors');
select throws_ok(
  $$insert into map_anchors (map_id, cx, cy, lat, lng, label)
    values ('eeeeeeee-0000-0000-0000-0000000000a1', 50, 50, 33.851, -96.641, 'Bob''s corner')$$,
  '42501', null, 'but cannot add one');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_alice_maps"}', true);
set local role authenticated;
select lives_ok(
  $$insert into map_anchors (id, map_id, cx, cy, lat, lng, label)
    values ('f0000000-0000-0000-0000-0000000000a2','eeeeeeee-0000-0000-0000-0000000000a1', 80, 10, 33.852, -96.642, 'NE corner')$$,
  'manage_locations adds a free calibration point with no location');
select lives_ok(
  $$update map_anchors set cx = 81 where id = 'f0000000-0000-0000-0000-0000000000a2'$$,
  'and moves it');
select lives_ok(
  $$delete from map_anchors where id = 'f0000000-0000-0000-0000-0000000000a2'$$,
  'and removes it');
reset role;

-- ── constraints ──────────────────────────────────────────────────────────
select throws_ok(
  $$insert into map_anchors (map_id, cx, cy) values ('eeeeeeee-0000-0000-0000-0000000000a1', 101, 50)$$,
  '23514', null, 'a map coordinate past 100% is rejected');
select throws_ok(
  $$insert into map_anchors (map_id, cx, cy, lat, lng) values ('eeeeeeee-0000-0000-0000-0000000000a1', 50, 50, 91, 0)$$,
  '23514', null, 'a latitude past 90 is rejected');

-- ── the anchor and its location agree on the coordinates ────────────────
update locations set gps_lat = 33.86, gps_lng = -96.65 where id = 'dddddddd-0000-0000-0000-0000000000a2';
select is((select lat from map_anchors where id = 'f0000000-0000-0000-0000-0000000000a1'), 33.86::double precision,
  'moving the location''s pin moves its anchor''s coordinates');
update map_anchors set lat = 33.87, lng = -96.66 where id = 'f0000000-0000-0000-0000-0000000000a1';
select is((select gps_lat from locations where id = 'dddddddd-0000-0000-0000-0000000000a2'), 33.87::double precision,
  'and setting coordinates on the anchor sets the location''s pin');
insert into map_anchors (map_id, location_id, cx, cy)
  values ('eeeeeeee-0000-0000-0000-0000000000a1','dddddddd-0000-0000-0000-0000000000a3', 60, 60);
update locations set gps_lat = 33.88, gps_lng = -96.67 where id = 'dddddddd-0000-0000-0000-0000000000a3';
select is((select lng from map_anchors where location_id = 'dddddddd-0000-0000-0000-0000000000a3'), -96.67::double precision,
  'a located anchor created before its pin picks the pin up when it arrives');

-- ── applying a proposal, either payload shape ───────────────────────────
select apply_map_placement('eeeeeeee-0000-0000-0000-0000000000a1', 'dddddddd-0000-0000-0000-0000000000a3',
  '{"map_id":"eeeeeeee-0000-0000-0000-0000000000a1","placement":{"cx":40,"cy":50,"dx":5,"dy":-2,"rotation":10,"fontSize":6}}'::jsonb);
select is((select cx::text || ',' || cy::text from map_anchors where location_id = 'dddddddd-0000-0000-0000-0000000000a3'), '40,50',
  'a legacy placement payload re-anchors the location');
select is((select cx::text || ',' || cy::text || ',' || font_size::text from map_labels where location_id = 'dddddddd-0000-0000-0000-0000000000a3'), '45,48,6',
  'and puts its label at anchor plus offset');
select apply_map_placement('eeeeeeee-0000-0000-0000-0000000000a1', 'dddddddd-0000-0000-0000-0000000000a3',
  '{"map_id":"eeeeeeee-0000-0000-0000-0000000000a1","anchor":{"cx":41,"cy":51},"label":{"cx":70,"cy":20,"rotation":0,"fontSize":9}}'::jsonb);
select is((select cx::text || ',' || cy::text from map_labels where location_id = 'dddddddd-0000-0000-0000-0000000000a3'), '70,20',
  'a new-shape payload puts the label where it says, independent of the anchor');

-- ── a map takes its anchors and labels with it ──────────────────────────
delete from marina_maps where id = 'eeeeeeee-0000-0000-0000-0000000000a1';
select is((select count(*) from map_anchors where map_id = 'eeeeeeee-0000-0000-0000-0000000000a1')::int
        + (select count(*) from map_labels  where map_id = 'eeeeeeee-0000-0000-0000-0000000000a1')::int, 0,
  'deleting a map deletes its anchors and labels');

select * from finish();
rollback;
