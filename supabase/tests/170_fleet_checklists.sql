-- The Fleet Vehicle Item (src/pages/checklists/ActiveChecklistPage.spec.md
-- § Fleet Vehicle Item; migration 20261021000200), tests 11–13 of the
-- approved list.
--
-- Undo deletes rows, so its access runs both halves: an active user deletes,
-- an inactive one and anon do not. Denial alone proves nothing (CLAUDE.md).
create extension if not exists pgtap;
begin;
select plan(15);

-- ── fixtures (as owner) ──────────────────────────────────────────────────
insert into users (id, name, clerk_user_id, active) values
  ('11111111-1111-1111-1111-1111111101f1', 'Gail — active',   'user_gail_fleetitem', true),
  ('22222222-2222-2222-2222-2222222201f1', 'Ivan — inactive', 'user_ivan_fleetitem', false);
insert into assets (id, name, has_meter, meter_type, meter_reading, checkoutable, is_fleet) values
  ('bbbbbbbb-0000-0000-0000-0000000001f1', 'Fleet Item Truck', true, 'mileage', 1000, true, true);
insert into asset_checkouts (id, asset_id) values
  ('cccccccc-0000-0000-0000-0000000001f1', 'bbbbbbbb-0000-0000-0000-0000000001f1'),
  ('cccccccc-0000-0000-0000-0000000001f2', 'bbbbbbbb-0000-0000-0000-0000000001f1'),
  ('cccccccc-0000-0000-0000-0000000001f3', 'bbbbbbbb-0000-0000-0000-0000000001f1');
insert into asset_meter_readings (id, asset_id, value, source) values
  ('eeeeeeee-0000-0000-0000-0000000001f1', 'bbbbbbbb-0000-0000-0000-0000000001f1', 1010, 'manual'),
  ('eeeeeeee-0000-0000-0000-0000000001f2', 'bbbbbbbb-0000-0000-0000-0000000001f1', 1020, 'manual');
insert into asset_fuel_logs (id, asset_id, gallons) values
  ('dddddddd-0000-0000-0000-0000000001f1', 'bbbbbbbb-0000-0000-0000-0000000001f1', 10),
  ('dddddddd-0000-0000-0000-0000000001f2', 'bbbbbbbb-0000-0000-0000-0000000001f1', 11);

-- ── 11. types and the kept flag ─────────────────────────────────────────
select ok('fleet_vehicle' = any (enum_range(null::checklist_item_type)::text[]),
  '11. fleet_vehicle is a checklist item type');
select ok('asset' = any (enum_range(null::template_trigger)::text[]),
  '11. asset is a template trigger');
select col_default_is('asset_checkouts', 'kept_after_shift', 'false',
  '11. kept_after_shift defaults to false');
select is((select count(*) from asset_checkouts where kept_after_shift is distinct from false)::int, 0,
  '11. and every existing checkout reads false');

-- ── 12. fuel log rows ───────────────────────────────────────────────────
select lives_ok(
  $$insert into asset_fuel_logs (asset_id, level) values ('bbbbbbbb-0000-0000-0000-0000000001f1', 2)$$,
  '12. a level reading with no gallons is accepted');
select lives_ok(
  $$insert into asset_fuel_logs (asset_id, gallons, cost, level) values ('bbbbbbbb-0000-0000-0000-0000000001f1', 9.5, 31.2, 4)$$,
  '12. a fill-up may carry its level');
select throws_ok(
  $$insert into asset_fuel_logs (asset_id) values ('bbbbbbbb-0000-0000-0000-0000000001f1')$$,
  '23514', null, '12. a row with neither gallons nor a level is rejected');
select throws_ok(
  $$insert into asset_fuel_logs (asset_id, level) values ('bbbbbbbb-0000-0000-0000-0000000001f1', 5)$$,
  '23514', null, '12. a level above full is rejected');
select is((select count(*) from asset_fuel_logs where id = 'dddddddd-0000-0000-0000-0000000001f1' and level is null)::int, 1,
  '12. a fill-up from before still stands, with no level');

-- ── 13. undo may delete ─────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_gail_fleetitem"}', true);
set local role authenticated;
select lives_ok(
  $$delete from asset_checkouts where id = 'cccccccc-0000-0000-0000-0000000001f1'$$,
  '13. an active user deletes a checkout');
select lives_ok(
  $$delete from asset_meter_readings where id = 'eeeeeeee-0000-0000-0000-0000000001f1'$$,
  '13. and a meter reading');
select lives_ok(
  $$delete from asset_fuel_logs where id = 'dddddddd-0000-0000-0000-0000000001f1'$$,
  '13. and a fuel log row');
reset role;
select is(
  (select count(*) from asset_checkouts where id = 'cccccccc-0000-0000-0000-0000000001f1')::int
  + (select count(*) from asset_meter_readings where id = 'eeeeeeee-0000-0000-0000-0000000001f1')::int
  + (select count(*) from asset_fuel_logs where id = 'dddddddd-0000-0000-0000-0000000001f1')::int,
  0, '13. all three are gone');

-- An inactive user's delete matches no row through RLS; it must leave them.
select set_config('request.jwt.claims', '{"sub":"user_ivan_fleetitem"}', true);
set local role authenticated;
delete from asset_checkouts where id = 'cccccccc-0000-0000-0000-0000000001f2';
delete from asset_meter_readings where id = 'eeeeeeee-0000-0000-0000-0000000001f2';
delete from asset_fuel_logs where id = 'dddddddd-0000-0000-0000-0000000001f2';
reset role;
select is(
  (select count(*) from asset_checkouts where id = 'cccccccc-0000-0000-0000-0000000001f2')::int
  + (select count(*) from asset_meter_readings where id = 'eeeeeeee-0000-0000-0000-0000000001f2')::int
  + (select count(*) from asset_fuel_logs where id = 'dddddddd-0000-0000-0000-0000000001f2')::int,
  3, '13. an inactive user deletes none of them');

set local role anon;
select throws_ok($$delete from asset_checkouts where id = 'cccccccc-0000-0000-0000-0000000001f3'$$, '42501', null,
  '13. anon is refused at the privilege layer');
reset role;

select * from finish();
rollback;
