-- Outlines on map labels (migration 20261007000100; docs/maps.md).
create extension if not exists pgtap;
begin;
select plan(9);

insert into users (id, name, clerk_user_id, active) values
  ('11111111-1111-1111-1111-1111111100b1', 'Alice — manages locations', 'user_alice_outl', true),
  ('22222222-2222-2222-2222-2222222200b1', 'Bob — no roles',             'user_bob_outl',   true);
insert into roles (id, name, allow) values ('aaaaaaaa-0000-0000-0000-0000000000b1', 'Outline Fixture Manager', array['manage_locations']);
insert into user_roles values ('11111111-1111-1111-1111-1111111100b1','aaaaaaaa-0000-0000-0000-0000000000b1');
insert into location_types (id, name) values ('cccccccc-0000-0000-0000-0000000000b1','Outline Fixture Type');
insert into locations (id, name, location_type_id) values
  ('dddddddd-0000-0000-0000-0000000000b1','Outline Fixture Root','cccccccc-0000-0000-0000-0000000000b1'),
  ('dddddddd-0000-0000-0000-0000000000b2','Outline Fixture Lot','cccccccc-0000-0000-0000-0000000000b1');
insert into marina_maps (id, name, scope_id) values ('eeeeeeee-0000-0000-0000-0000000000b1','Outline Fixture Map','dddddddd-0000-0000-0000-0000000000b1');

-- ── 4: what an outline must be ──────────────────────────────────────────
select throws_ok(
  $$insert into map_labels (map_id, location_id, cx, cy, outline)
    values ('eeeeeeee-0000-0000-0000-0000000000b1','dddddddd-0000-0000-0000-0000000000b2', 20, 20, '[[10,10],[30,10]]')$$,
  '23514', null, 'an outline of two points is rejected');
select throws_ok(
  $$insert into map_labels (map_id, location_id, cx, cy, outline)
    values ('eeeeeeee-0000-0000-0000-0000000000b1','dddddddd-0000-0000-0000-0000000000b2', 20, 20, '[[10,10],[130,10],[30,30]]')$$,
  '23514', null, 'an outline point past 100% is rejected');
select throws_ok(
  $$insert into map_labels (map_id, location_id, cx, cy, show_text)
    values ('eeeeeeee-0000-0000-0000-0000000000b1','dddddddd-0000-0000-0000-0000000000b2', 20, 20, false)$$,
  '23514', null, 'hiding the text with no outline - drawing nothing - is rejected');

-- ── 5: read for all, write with manage_locations ────────────────────────
insert into map_labels (id, map_id, location_id, cx, cy, outline, show_text)
  values ('f0000000-0000-0000-0000-0000000000b1','eeeeeeee-0000-0000-0000-0000000000b1','dddddddd-0000-0000-0000-0000000000b2', 20, 20, '[[10,10],[30,10],[30,30]]', false);
select set_config('request.jwt.claims', '{"sub":"user_bob_outl"}', true);
set local role authenticated;
select is((select jsonb_array_length(outline) from map_labels where id = 'f0000000-0000-0000-0000-0000000000b1'), 3,
  'a user without manage_locations reads the outline');
select is_empty(
  $$update map_labels set outline = '[[1,1],[2,1],[2,2]]' where id = 'f0000000-0000-0000-0000-0000000000b1' returning id$$,
  'but cannot change it');
reset role;
select set_config('request.jwt.claims', '{"sub":"user_alice_outl"}', true);
set local role authenticated;
select isnt_empty(
  $$update map_labels set outline = '[[1,1],[20,1],[20,20]]' where id = 'f0000000-0000-0000-0000-0000000000b1' returning id$$,
  'manage_locations changes it');
reset role;

-- ── 6: proposals ────────────────────────────────────────────────────────
select apply_map_placement('eeeeeeee-0000-0000-0000-0000000000b1','dddddddd-0000-0000-0000-0000000000b2',
  '{"map_id":"eeeeeeee-0000-0000-0000-0000000000b1","anchor":null,"label":{"cx":40,"cy":40,"rotation":0,"outline":[[35,35],[45,35],[45,45]],"showText":true}}'::jsonb);
select is((select outline::text || ' ' || show_text::text from map_labels where id = 'f0000000-0000-0000-0000-0000000000b1'),
  '[[35, 35], [45, 35], [45, 45]] true', 'a proposal carrying an outline writes it, and its text switch');
select apply_map_placement('eeeeeeee-0000-0000-0000-0000000000b1','dddddddd-0000-0000-0000-0000000000b2',
  '{"map_id":"eeeeeeee-0000-0000-0000-0000000000b1","anchor":null,"label":{"cx":41,"cy":41,"rotation":0}}'::jsonb);
select is((select jsonb_array_length(outline) from map_labels where id = 'f0000000-0000-0000-0000-0000000000b1'), 3,
  'a proposal without an outline leaves the outline that is there');
select apply_map_placement('eeeeeeee-0000-0000-0000-0000000000b1','dddddddd-0000-0000-0000-0000000000b2',
  '{"map_id":"eeeeeeee-0000-0000-0000-0000000000b1","anchor":null,"label":{"cx":41,"cy":41,"rotation":0,"outline":null,"showText":false}}'::jsonb);
select is((select coalesce(outline::text, 'none') || ' ' || show_text::text from map_labels where id = 'f0000000-0000-0000-0000-0000000000b1'),
  'none true', 'a proposal that removes the outline brings the text back, so the row still draws something');

select * from finish();
rollback;
