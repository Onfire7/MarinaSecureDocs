-- Sync scope flags.
--
-- These carry the time windows that a sync rule cannot express. If they are
-- wrong, a device silently holds the wrong data — too much (a privacy and
-- size problem) or too little (a guard on a dock with no boat details, which
-- is the defect this whole migration exists to fix).
create extension if not exists pgtap;
begin;
select plan(7);

insert into location_types (id, name) values ('aaaa0000-0000-4000-8000-00000000006a','Scope Fixture Type');
insert into locations (id, name, location_type_id) values
  ('aaaa0000-0000-4000-8000-00000000006b','Scope Fixture Slip','aaaa0000-0000-4000-8000-00000000006a');

-- Three contacts: on a live lease, departed inside the window, departed well
-- outside it.
insert into contacts (id, name) values
  ('aaaa0000-0000-4000-8000-000000000001','Current Lessee'),
  ('aaaa0000-0000-4000-8000-000000000002','Departed Last Week'),
  ('aaaa0000-0000-4000-8000-000000000003','Departed Last Year');
insert into contact_details (contact_id, phone) values
  ('aaaa0000-0000-4000-8000-000000000001','5550000001');

insert into leases (id, location_id, start_date, end_date) values
  ('aaaa0000-0000-4000-8000-00000000000a','aaaa0000-0000-4000-8000-00000000006b',
   now() - interval '2 years', now() + interval '1 year');
insert into lease_lessees (lease_id, contact_id) values
  ('aaaa0000-0000-4000-8000-00000000000a','aaaa0000-0000-4000-8000-000000000001');

insert into reservations (id, status, contact_id, location_id, expected_checkin, expected_checkout) values
  ('aaaa0000-0000-4000-8000-00000000000b','checked_out','aaaa0000-0000-4000-8000-000000000002',
   'aaaa0000-0000-4000-8000-00000000006b', now() - interval '10 days', now() - interval '7 days'),
  ('aaaa0000-0000-4000-8000-00000000000c','checked_out','aaaa0000-0000-4000-8000-000000000003',
   'aaaa0000-0000-4000-8000-00000000006b', now() - interval '400 days', now() - interval '395 days');

insert into check_ins (id, checkpoint_id, user_id, timestamp, method)
select 'aaaa0000-0000-4000-8000-00000000000d', null,
       (select id from users limit 1), now() - interval '1 day', 'scanned';
insert into check_ins (id, checkpoint_id, user_id, timestamp, method)
select 'aaaa0000-0000-4000-8000-00000000000e', null,
       (select id from users limit 1), now() - interval '60 days', 'scanned';

select public.refresh_sync_scopes_all();

select ok((select is_resident from contacts where id='aaaa0000-0000-4000-8000-000000000001'),
  'a contact on a current lease is resident');

-- The trailing window is the whole reason an incident follow-up works offline.
select ok((select is_resident from contacts where id='aaaa0000-0000-4000-8000-000000000002'),
  'a guest who departed 7 days ago is STILL resident — the 30-day trailing window');

select ok(not (select is_resident from contacts where id='aaaa0000-0000-4000-8000-000000000003'),
  'a guest who departed over a year ago is not resident');

-- A child cannot be scoped by a subquery off its parent, so it carries its
-- own copy. If this drifts, contact_details syncs to devices that should
-- never see a phone number.
select ok((select is_resident from contact_details where contact_id='aaaa0000-0000-4000-8000-000000000001'),
  'contact_details inherits its contact''s residency');

select ok((select is_recent from check_ins where id='aaaa0000-0000-4000-8000-00000000000d'),
  'a check-in from yesterday is recent');
select ok(not (select is_recent from check_ins where id='aaaa0000-0000-4000-8000-00000000000e'),
  'a check-in from 60 days ago is not recent');

-- required_permission is what makes the gate compile into a bucket parameter.
-- A wrong or missing value here means the stream is ungated.
select is(
  (select array_agg(distinct required_permission order by required_permission)
     from (select required_permission from contacts
            union all select required_permission from contact_details
            union all select required_permission from incidents) t),
  array['view_contact','view_incidents','view_owner'],
  'each gated table demands the permission its stream is parameterised by');

select * from finish();
rollback;
