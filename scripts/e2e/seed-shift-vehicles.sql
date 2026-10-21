-- Seeds the LOCAL database for scripts/e2e/shift-vehicles.mjs. Never run
-- against a marina's database: it links the test account to a contact and
-- ends any shift it is on. Idempotent: removes its own rows first.
--
--   A shift of the test account, 10 PM to 6 AM, ended.
--   "Patrol Truck e2e": checked out at 10:30 PM (odometer 48000) and back at
--     5:58 AM (48040, fuel ½, note "Mud on the seats"), post-return status
--     "Needs Cleaning" logged at the check-in; an incident "Scraped mirror
--     e2e" and a ticket "Replace mirror e2e" raised on it by the guard at
--     1:15 and 1:20 AM.
--   "Cart e2e": never taken; one manual reading of 18240 at 2:10 AM by the
--     guard, which is the only thing to show for it.
do $$
declare
  me         uuid := (select id from users where email = 'gpp@onfire.us');
  my_contact uuid;
  cleaning   uuid;
  inc_open   uuid := (select id from incident_statuses where is_terminal = false order by name limit 1);
  tkt_open   uuid := (select id from ticket_statuses   where is_terminal = false order by name limit 1);
  t0 timestamptz := date_trunc('day', now()) - interval '1 day' + interval '22 hours';
  truck uuid; cart uuid; shift uuid;
begin
  my_contact := (select contact_id from users where id = me);
  if my_contact is null then
    insert into contacts (name) values ('Me e2e') returning id into my_contact;
    update users set contact_id = my_contact where id = me;
  end if;
  insert into asset_statuses (name, position) values ('Needs Cleaning', 5) on conflict (name) do nothing;
  cleaning := (select id from asset_statuses where name = 'Needs Cleaning');

  delete from incidents where title like '% e2e' and asset_id in (select id from assets where name like '% e2e');
  delete from tickets   where title like '% e2e' and asset_id in (select id from assets where name like '% e2e');
  delete from asset_checkouts      where asset_id in (select id from assets where name in ('Patrol Truck e2e', 'Cart e2e'));
  delete from asset_meter_readings where asset_id in (select id from assets where name in ('Patrol Truck e2e', 'Cart e2e'));
  delete from asset_status_logs    where asset_id in (select id from assets where name in ('Patrol Truck e2e', 'Cart e2e'));
  delete from assets where name in ('Patrol Truck e2e', 'Cart e2e');
  update shifts set ended_at = coalesce(ended_at, now()) where guard_id = me and ended_at is null;
  delete from shifts where guard_id = me and started_at = t0;

  insert into shifts (guard_id, started_at, ended_at) values (me, t0, t0 + interval '8 hours') returning id into shift;

  insert into assets (name, category, has_meter, meter_type, meter_reading, checkoutable, is_fleet, post_return_status_id)
    values ('Patrol Truck e2e', 'Vehicles', true, 'mileage', 48040, true, true, cleaning) returning id into truck;
  insert into asset_checkouts (asset_id, person_id, checked_out_by_id, time_out, time_in, odometer_out, odometer_in, fuel_level_in, return_note)
    values (truck, my_contact, me, t0 + interval '30 minutes', t0 + interval '7 hours 58 minutes', 48000, 48040, 2, 'Mud on the seats');
  insert into asset_meter_readings (asset_id, value, source, timestamp, logged_by_id) values
    (truck, 48000, 'manual', t0 + interval '30 minutes', me),
    (truck, 48040, 'manual', t0 + interval '7 hours 58 minutes', me);
  insert into asset_status_logs (asset_id, status_id, note, timestamp, logged_by_id)
    values (truck, cleaning, 'Returned from checkout', t0 + interval '7 hours 58 minutes', me);
  insert into incidents (title, status_id, details, created_at, author_id, asset_id)
    values ('Scraped mirror e2e', inc_open, 'Caught the gate post backing out.', t0 + interval '3 hours 15 minutes', me, truck);
  insert into tickets (title, status_id, priority, created_at, created_by_id, asset_id)
    values ('Replace mirror e2e', tkt_open, 'medium', t0 + interval '3 hours 20 minutes', me, truck);

  insert into assets (name, category, has_meter, meter_type, meter_reading, checkoutable, is_fleet)
    values ('Cart e2e', 'Vehicles', true, 'mileage', 18240, true, true) returning id into cart;
  insert into asset_meter_readings (asset_id, value, source, timestamp, logged_by_id)
    values (cart, 18240, 'manual', t0 + interval '4 hours 10 minutes', me);
end $$;

select refresh_sync_scopes_all();
