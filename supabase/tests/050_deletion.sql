-- Deletion semantics.
--
-- Two rules, and the distinction between them is the whole design:
--   * Evidence RESTRICTS its parent. Deleting a cabin that has reservations
--     fails, loudly, rather than removing them.
--   * Composition still CASCADES. A comment has no meaning without the
--     incident it is attached to.
--
-- RESTRICT is temporary: once the Records Archive exists (docs/ROADMAP.md),
-- deletion moves server-side, snapshots the cascade, and these go back to
-- CASCADE. Until then this test is what stops evidence disappearing quietly.
create extension if not exists pgtap;
begin;
select plan(5);

insert into location_types (id, name) values ('11111111-0000-4000-8000-00000000000d','Del Fixture Type');
insert into locations (id, name, location_type_id) values
  ('22222222-0000-4000-8000-00000000000d','Del Fixture Cabin','11111111-0000-4000-8000-00000000000d'),
  ('33333333-0000-4000-8000-00000000000d','Del Fixture Empty','11111111-0000-4000-8000-00000000000d');
insert into incident_statuses (id, name) values ('44444444-0000-4000-8000-00000000000d','Del Fixture Open');
insert into incidents (id, title, status_id, location_id) values
  ('55555555-0000-4000-8000-00000000000d','Evidence','44444444-0000-4000-8000-00000000000d',
   '22222222-0000-4000-8000-00000000000d');
insert into incident_comments (id, incident_id, body) values
  ('66666666-0000-4000-8000-00000000000d','55555555-0000-4000-8000-00000000000d','Addendum');

-- 1. Evidence blocks the delete. 23503 = foreign_key_violation.
select throws_ok(
  $$delete from locations where id = '22222222-0000-4000-8000-00000000000d'$$,
  '23503', null,
  'deleting a location with an incident attached is REFUSED, not silently cascaded');

-- 2. The refusal must not be blanket — a location with nothing attached still
--    deletes, or "restrict" is just a broken delete.
select lives_ok(
  $$delete from locations where id = '33333333-0000-4000-8000-00000000000d'$$,
  'a location with nothing attached still deletes');

-- 3. Composition is untouched: removing the incident takes its comments.
delete from incidents where id = '55555555-0000-4000-8000-00000000000d';
select is(
  (select count(*) from incident_comments where id = '66666666-0000-4000-8000-00000000000d')::int, 0,
  'deleting an incident still cascades its comments — composition, not evidence');

-- 4. And with the evidence gone, the location is deletable.
select lives_ok(
  $$delete from locations where id = '22222222-0000-4000-8000-00000000000d'$$,
  'once its incident is gone the location deletes');

-- 5. The activity log never cascades from anything: subject_id is not a
--    foreign key, so an entry survives whatever it describes.
insert into activity_log_entries (id, event_type, summary, subject_type, subject_id) values
  ('77777777-0000-4000-8000-00000000000d','location.deleted','Del Fixture Cabin removed',
   'locations','22222222-0000-4000-8000-00000000000d');
select is(
  (select count(*) from activity_log_entries where id = '77777777-0000-4000-8000-00000000000d')::int, 1,
  'an activity log entry outlives the record it describes');

select * from finish();
rollback;
