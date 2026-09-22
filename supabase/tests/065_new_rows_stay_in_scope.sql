-- A row someone just created must not vanish from the phone that created it.
--
-- Occupancy scoping asks "is this on a current lease or reservation?", and for
-- a contact, boat or booking made thirty seconds ago the answer is usually
-- "not yet". The flags defaulted to false and the refresh agreed, so the row
-- uploaded, left the device's sync scope, and was deleted from the phone —
-- permanently, for anything never attached to a lease. With an empty marina
-- that is every owner and every boat anyone adds.
create extension if not exists pgtap;
begin;
select plan(14);

insert into location_types (id, name) values ('bbbb0000-0000-4000-8000-00000000006a','Grace Fixture Type');
insert into locations (id, name, location_type_id) values
  ('bbbb0000-0000-4000-8000-00000000006b','Grace Fixture Slip','bbbb0000-0000-4000-8000-00000000006a'),
  ('bbbb0000-0000-4000-8000-00000000006c','Grace Fixture Slip 2','bbbb0000-0000-4000-8000-00000000006a');

-- ── contacts ─────────────────────────────────────────────────────────────
insert into contacts (id, name) values
  ('bbbb0000-0000-4000-8000-000000000001','Added Just Now'),
  ('bbbb0000-0000-4000-8000-000000000002','Added Long Ago, Never Leased'),
  ('bbbb0000-0000-4000-8000-000000000003','Added Long Ago, On A Lease');
insert into contact_details (contact_id, phone) values
  ('bbbb0000-0000-4000-8000-000000000001','5550000011');

select ok((select is_resident from contacts where id='bbbb0000-0000-4000-8000-000000000001'),
  'a new contact is in scope immediately, before any refresh');
select ok((select is_resident from contact_details where contact_id='bbbb0000-0000-4000-8000-000000000001'),
  'and so are its details');

update contacts set created_at = now() - interval '45 days'
 where id in ('bbbb0000-0000-4000-8000-000000000002','bbbb0000-0000-4000-8000-000000000003');

-- ── boats ────────────────────────────────────────────────────────────────
insert into boats (id, name) values
  ('bbbb0000-0000-4000-8000-000000000011','Boat Added Just Now'),
  ('bbbb0000-0000-4000-8000-000000000012','Boat Added Long Ago, Unattached'),
  ('bbbb0000-0000-4000-8000-000000000013','Boat Added Long Ago, Owned By A Lessee');
insert into boat_owners (boat_id, contact_id, position) values
  ('bbbb0000-0000-4000-8000-000000000011','bbbb0000-0000-4000-8000-000000000001',0),
  ('bbbb0000-0000-4000-8000-000000000013','bbbb0000-0000-4000-8000-000000000003',0);
select ok((select is_resident from boats where id='bbbb0000-0000-4000-8000-000000000011'),
  'a new boat is in scope immediately');
update boats set created_at = now() - interval '45 days'
 where id in ('bbbb0000-0000-4000-8000-000000000012','bbbb0000-0000-4000-8000-000000000013');

-- Both bookings belong to the NEW contact: a booking entered today rightly
-- pulls its guest into scope, which would spoil the never-leased fixture.
-- ── leases & reservations ────────────────────────────────────────────────
insert into leases (id, location_id, start_date, end_date) values
  ('bbbb0000-0000-4000-8000-00000000000a','bbbb0000-0000-4000-8000-00000000006b',
   now() - interval '1 year', now() + interval '1 year'),
  -- Signed today for next season: not "current" by date, and exactly what
  -- someone in the office has just typed in and expects to still see.
  ('bbbb0000-0000-4000-8000-00000000000b','bbbb0000-0000-4000-8000-00000000006c',
   now() + interval '90 days', now() + interval '1 year');
insert into lease_lessees (lease_id, contact_id) values
  ('bbbb0000-0000-4000-8000-00000000000a','bbbb0000-0000-4000-8000-000000000003');

insert into reservations (id, status, contact_id, location_id, expected_checkin, expected_checkout) values
  ('bbbb0000-0000-4000-8000-000000000021','confirmed','bbbb0000-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-00000000006b',
   now() + interval '120 days', now() + interval '123 days'),
  ('bbbb0000-0000-4000-8000-000000000022','checked_out','bbbb0000-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-00000000006b',
   now() - interval '400 days', now() - interval '395 days');
select ok((select is_current from reservations where id='bbbb0000-0000-4000-8000-000000000021'),
  'a new reservation is in scope immediately');
update reservations set created_at = now() - interval '420 days'
 where id='bbbb0000-0000-4000-8000-000000000022';

select public.refresh_sync_scopes_all();

-- The row that used to vanish.
select ok((select is_resident from contacts where id='bbbb0000-0000-4000-8000-000000000001'),
  'a new contact with no lease STAYS in scope after a refresh');
select ok((select is_resident from contact_details where contact_id='bbbb0000-0000-4000-8000-000000000001'),
  'contact_details follows its contact through the grace period');
select ok(not (select is_resident from contacts where id='bbbb0000-0000-4000-8000-000000000002'),
  'a contact older than 30 days with no lease drops out');
select ok((select is_resident from contacts where id='bbbb0000-0000-4000-8000-000000000003'),
  'an old contact on a current lease stays in');

select ok((select is_resident from boats where id='bbbb0000-0000-4000-8000-000000000011'),
  'a new boat STAYS in scope after a refresh');
select ok((select is_resident from boat_owners where boat_id='bbbb0000-0000-4000-8000-000000000011'),
  'and so does the link to its owner');
select ok(not (select is_resident from boats where id='bbbb0000-0000-4000-8000-000000000012'),
  'a boat older than 30 days, unattached, drops out');
select ok((select is_resident from boats where id='bbbb0000-0000-4000-8000-000000000013'),
  'an old boat owned by a current lessee stays in');

select ok((select is_current from leases where id='bbbb0000-0000-4000-8000-00000000000b'),
  'a lease signed today for next season stays in scope');
select ok(
  (select is_current from reservations where id='bbbb0000-0000-4000-8000-000000000021')
  and not (select is_current from reservations where id='bbbb0000-0000-4000-8000-000000000022'),
  'a booking made today for a far date stays in; an old, long-departed one does not');

select * from finish();
rollback;
