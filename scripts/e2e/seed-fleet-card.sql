-- Seeds the LOCAL database for scripts/e2e/fleet-card.mjs. Never run against a
-- marina's database: it clears the test account's dashboard layout, links it
-- to a contact, and gives it a role that denies permissions on demand.
--
-- Defines e2e_fleet_reset(vehicles, deny), which the script calls before each
-- scenario, and runs it once with vehicles and nothing denied.
--
--   Users (no Clerk identity; they only hold vehicles):
--     "Dana e2e"       linked to contact "Dana e2e contact"
--     "No Contact e2e" with no contact, so the person picker leaves them out
--   The test account is linked to contact "Me e2e" if it has none, and its
--   dashboard_layout is cleared so it gets the role-default layout, which
--   includes Fleet for Security.
--
--   Fleet Vehicles, when `vehicles`:
--     "Truck e2e"  mileage 1000 (one reading), Available, no checkout.
--                  Maintenance rule every 500 mi, label "Oil change e2e".
--     "Mine e2e"   mileage 2015, checked out to the test account an hour
--                  ago with odometer_out 2000; post-return status Available.
--     "Van e2e"    mileage 500, checked out to Dana e2e.
--     "Cart e2e"   no meter, current status Out of Service.
--   Every other asset has is_fleet cleared, so `vehicles = false` leaves the
--   marina with none.
--
--   `deny` is a list of permissions denied to the test account through the
--   role "Fleet e2e deny" (deny wins over any allow): use_fleet,
--   create_incidents, manage_assets.

insert into asset_statuses (name, position) values ('Available', 0) on conflict (name) do nothing;
insert into asset_statuses (name, position) values ('Out of Service', 9) on conflict (name) do nothing;

create or replace function e2e_fleet_reset(vehicles boolean, deny text[])
returns void language plpgsql as $$
declare
  me        uuid := (select id from users where email = 'gpp@onfire.us');
  my_contact uuid;
  dana      uuid;
  dana_c    uuid;
  available uuid := (select id from asset_statuses where name = 'Available');
  oos       uuid := (select id from asset_statuses where name = 'Out of Service');
  truck uuid; mine uuid; van uuid; cart uuid;
  deny_role uuid;
begin
  -- ── people ─────────────────────────────────────────────────────────────
  my_contact := (select contact_id from users where id = me);
  if my_contact is null then
    insert into contacts (name) values ('Me e2e') returning id into my_contact;
    update users set contact_id = my_contact where id = me;
  end if;
  update users set dashboard_layout = null where id = me;

  dana_c := (select id from contacts where name = 'Dana e2e contact' limit 1);
  if dana_c is null then
    insert into contacts (name) values ('Dana e2e contact') returning id into dana_c;
  end if;
  dana := (select id from users where name = 'Dana e2e');
  if dana is null then
    insert into users (name, active, contact_id) values ('Dana e2e', true, dana_c) returning id into dana;
  end if;
  if not exists (select 1 from users where name = 'No Contact e2e') then
    insert into users (name, active) values ('No Contact e2e', true);
  end if;

  -- ── permissions ────────────────────────────────────────────────────────
  delete from user_roles where role_id in (select id from roles where name = 'Fleet e2e deny');
  delete from roles where name = 'Fleet e2e deny';
  if coalesce(array_length(deny, 1), 0) > 0 then
    insert into roles (name, deny) values ('Fleet e2e deny', deny) returning id into deny_role;
    insert into user_roles (user_id, role_id) values (me, deny_role);
  end if;

  -- ── vehicles ───────────────────────────────────────────────────────────
  delete from tickets              where asset_id in (select id from assets where name like '% e2e');
  delete from asset_fuel_logs      where asset_id in (select id from assets where name like '% e2e');
  delete from asset_checkouts      where asset_id in (select id from assets where name like '% e2e');
  delete from asset_meter_readings where asset_id in (select id from assets where name like '% e2e');
  delete from asset_status_logs    where asset_id in (select id from assets where name like '% e2e');
  delete from assets where name like '% e2e';
  update assets set is_fleet = false where is_fleet;

  if not vehicles then return; end if;

  insert into assets (name, category, has_meter, meter_type, meter_reading, checkoutable, is_fleet, post_return_status_id)
    values ('Truck e2e', 'Vehicles', true, 'mileage', 1000, true, true, available) returning id into truck;
  insert into asset_meter_readings (asset_id, value, source, timestamp)
    values (truck, 1000, 'manual', now() - interval '1 day');
  insert into maintenance_rules (asset_id, kind, every, label) values (truck, 'meter', 500, 'Oil change e2e');
  insert into asset_status_logs (asset_id, status_id, timestamp) values (truck, available, now() - interval '1 day');

  insert into assets (name, category, has_meter, meter_type, meter_reading, checkoutable, is_fleet, post_return_status_id)
    values ('Mine e2e', 'Vehicles', true, 'mileage', 2015, true, true, available) returning id into mine;
  insert into asset_meter_readings (asset_id, value, source, timestamp)
    values (mine, 2000, 'manual', now() - interval '2 hours'), (mine, 2015, 'manual', now() - interval '10 minutes');
  insert into asset_status_logs (asset_id, status_id, timestamp) values (mine, available, now() - interval '1 day');
  insert into asset_checkouts (asset_id, person_id, checked_out_by_id, time_out, odometer_out)
    values (mine, my_contact, me, now() - interval '1 hour', 2000);

  insert into assets (name, category, has_meter, meter_type, meter_reading, checkoutable, is_fleet)
    values ('Van e2e', 'Vehicles', true, 'mileage', 500, true, true) returning id into van;
  insert into asset_checkouts (asset_id, person_id, checked_out_by_id, time_out, odometer_out)
    values (van, dana_c, dana, now() - interval '3 hours', 480);

  insert into assets (name, category, has_meter, checkoutable, is_fleet)
    values ('Cart e2e', 'Vehicles', false, true, true) returning id into cart;
  insert into asset_status_logs (asset_id, status_id, timestamp) values (cart, oos, now() - interval '1 hour');
end $$;

-- Grant use_fleet to Security as the migration does: the seed loads roles
-- from an export taken before use_fleet existed.
update roles set allow = array_append(allow, 'use_fleet')
 where name = 'Security' and not ('use_fleet' = any (allow));

select e2e_fleet_reset(true, '{}');
