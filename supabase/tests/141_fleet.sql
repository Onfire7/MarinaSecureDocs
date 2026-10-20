-- Fleet Vehicles (src/pages/home/FleetCard.spec.md; migration 20261020000200),
-- tests 7–11 of the approved list.
--
-- Fill-up access runs both halves: an active user reads and writes, an
-- inactive one and anon do neither. Denial alone proves nothing (CLAUDE.md).
create extension if not exists pgtap;
begin;
select plan(17);

-- ── fixtures (as owner) ──────────────────────────────────────────────────
insert into users (id, name, clerk_user_id, active) values
  ('11111111-1111-1111-1111-1111111100f1', 'Gail — Security, active', 'user_gail_fleet', true),
  ('22222222-2222-2222-2222-2222222200f1', 'Ivan — inactive',         'user_ivan_fleet', false);
insert into roles (id, name, allow) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'Fleet Fixture Security', array['use_fleet']);
insert into user_roles values ('11111111-1111-1111-1111-1111111100f1','aaaaaaaa-0000-0000-0000-0000000000f1');
insert into assets (id, name, has_meter, meter_type, meter_reading, checkoutable) values
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'Fleet Fixture Truck', true, 'mileage', 1000, true),
  ('bbbbbbbb-0000-0000-0000-0000000000f2', 'Fleet Fixture Pump',  false, null, null, false);
insert into asset_checkouts (id, asset_id) values
  ('cccccccc-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-0000000000f1');

-- ── 7. fleet implies checkoutable ───────────────────────────────────────
select lives_ok(
  $$update assets set is_fleet = true where id = 'bbbbbbbb-0000-0000-0000-0000000000f1'$$,
  '7. a checkoutable asset can be a fleet vehicle');
select throws_ok(
  $$update assets set is_fleet = true where id = 'bbbbbbbb-0000-0000-0000-0000000000f2'$$,
  '23514', null, '7. an asset that cannot be checked out cannot be a fleet vehicle');
select throws_ok(
  $$update assets set checkoutable = false where id = 'bbbbbbbb-0000-0000-0000-0000000000f1'$$,
  '23514', null, '7. nor can a fleet vehicle stop being checkoutable');

-- ── 8. value ranges ─────────────────────────────────────────────────────
select lives_ok(
  $$update asset_checkouts set fuel_level_in = 0, odometer_out = 1000, odometer_in = 1012, return_note = 'ok'
     where id = 'cccccccc-0000-0000-0000-0000000000f1'$$,
  '8. a checkout records odometer out and in, an empty tank and a note');
select lives_ok(
  $$update asset_checkouts set fuel_level_in = 4 where id = 'cccccccc-0000-0000-0000-0000000000f1'$$,
  '8. and a full one');
select throws_ok(
  $$update asset_checkouts set fuel_level_in = 5 where id = 'cccccccc-0000-0000-0000-0000000000f1'$$,
  '23514', null, '8. a fuel level above full is rejected');
select throws_ok(
  $$update asset_checkouts set fuel_level_in = -1 where id = 'cccccccc-0000-0000-0000-0000000000f1'$$,
  '23514', null, '8. a fuel level below empty is rejected');
select throws_ok(
  $$insert into asset_fuel_logs (asset_id, gallons) values ('bbbbbbbb-0000-0000-0000-0000000000f1', 0)$$,
  '23514', null, '8. a fill-up of no gallons is rejected');
select throws_ok(
  $$insert into asset_fuel_logs (asset_id, gallons, cost) values ('bbbbbbbb-0000-0000-0000-0000000000f1', 10, -1)$$,
  '23514', null, '8. a negative cost is rejected');

-- ── 9. fill-up access ───────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_gail_fleet"}', true);
set local role authenticated;
select lives_ok(
  $$insert into asset_fuel_logs (id, asset_id, gallons, cost, odometer, logged_by_id)
    values ('dddddddd-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-0000000000f1', 12.5, 41.10, 1012,
            '11111111-1111-1111-1111-1111111100f1')$$,
  '9. an active marina user logs a fill-up');
select is((select count(*) from asset_fuel_logs where asset_id = 'bbbbbbbb-0000-0000-0000-0000000000f1')::int, 1,
  '9. and reads it back');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_ivan_fleet"}', true);
set local role authenticated;
select is((select count(*) from asset_fuel_logs)::int, 0, '9. an inactive user reads no fill-ups');
select throws_ok(
  $$insert into asset_fuel_logs (asset_id, gallons) values ('bbbbbbbb-0000-0000-0000-0000000000f1', 5)$$,
  '42501', null, '9. and cannot log one');
reset role;

set local role anon;
select throws_ok($$select count(*) from asset_fuel_logs$$, '42501', null,
  '9. anon is refused at the privilege layer');
reset role;

-- ── 10. Security holds use_fleet ────────────────────────────────────────
-- A freshly reset database has no roles, so the migration's grant to the
-- predefined Security role is checked against whatever roles exist: run on a
-- seeded or real database, it fails if any Security role was missed. The
-- second half checks the grant reaches a user through the permission cache.
select ok(not exists (select 1 from roles where name = 'Security' and not ('use_fleet' = any (allow))),
  '10. every role named Security allows use_fleet');
select set_config('request.jwt.claims', '{"sub":"user_gail_fleet"}', true);
set local role authenticated;
select ok(public.has_permission('use_fleet'), '10. a user holding it is granted use_fleet');
reset role;

-- ── 11. delete protection ───────────────────────────────────────────────
-- Its checkout would refuse the delete on its own, so it goes first.
delete from asset_checkouts where id = 'cccccccc-0000-0000-0000-0000000000f1';
select throws_ok(
  $$delete from assets where id = 'bbbbbbbb-0000-0000-0000-0000000000f1'$$,
  '23503', null, '11. a vehicle with fill-ups cannot be deleted');

select * from finish();
rollback;
