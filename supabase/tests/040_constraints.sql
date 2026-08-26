-- Constraints the data model promises.
--
-- These are the invariants that moved OUT of application code and into the
-- database. The attachment target is the reason to redesign rather than port:
-- instant.schema.ts asserted that "the app enforces that exactly one is set",
-- and one of seven real tickets did not have one.
create extension if not exists pgtap;
begin;
select plan(8);

-- Lookup names are unique and the seed loads real ones; fixtures use names
-- that cannot collide.
insert into ticket_statuses (id, name) values ('bbbbbbbb-0000-0000-0000-00000000000f','Fixture Open');
insert into location_types  (id, name) values ('cccccccc-0000-0000-0000-00000000000f','Fixture Slip');
insert into locations (id, name, location_type_id)
  values ('dddddddd-0000-0000-0000-00000000000f','Slip 14','cccccccc-0000-0000-0000-00000000000f');
insert into assets (id, name) values ('aaaaaaaa-0000-0000-0000-00000000000f','Cart 3');
insert into contacts (id, name) values ('ffffffff-0000-0000-0000-00000000000f','Dana Reyes');

-- ── exactly one attachment target ────────────────────────────────────────
select throws_ok(
  $$insert into notes (body, location_id, asset_id)
    values ('two targets','dddddddd-0000-0000-0000-00000000000f','aaaaaaaa-0000-0000-0000-00000000000f')$$,
  '23514', null,
  'a note attached to TWO targets is rejected');

select throws_ok(
  $$insert into notes (body) values ('no target')$$,
  '23514', null,
  'a note attached to NOTHING is rejected');

-- The actual row from migration/instant-export/tickets.json: an auto-raised
-- "Door left unlocked" ticket carrying a source incident but no attachment
-- target. It is why the transform drops one row rather than carrying it.
select throws_ok(
  $$insert into tickets (title, description, status_id, auto_generated)
    values ('Door left unlocked: Water Storage Door',
            'Water Storage Door: found unlocked, left unlocked (expected locked)',
            'bbbbbbbb-0000-0000-0000-00000000000f', false)$$,
  '23514', null,
  'the real targetless ticket from the Instant export is rejected');

-- Positive case: the constraint must permit the ordinary shape, or it is
-- merely an elaborate way of rejecting everything.
select lives_ok(
  $$insert into tickets (title, status_id, location_id)
    values ('Loose cleat','bbbbbbbb-0000-0000-0000-00000000000f','dddddddd-0000-0000-0000-00000000000f')$$,
  'a ticket with exactly one target is accepted');

-- ── marina_settings is a singleton ───────────────────────────────────────
-- The seed loads a real marina_settings row, so clear it inside this
-- transaction rather than assuming an empty table. The rollback restores it.
delete from marina_settings;
insert into marina_settings (id, marina_name) values (1, 'Harborview');
select throws_ok(
  $$insert into marina_settings (id, marina_name) values (2, 'Second marina')$$,
  '23514', null,
  'a second marina_settings row is rejected');

-- ── a reservation targets exactly one thing ──────────────────────────────
select throws_ok(
  $$insert into reservations (contact_id) values ('ffffffff-0000-0000-0000-00000000000f')$$,
  '23514', null,
  'a reservation with no target is rejected');

select throws_ok(
  $$insert into reservations (contact_id, location_id, asset_id)
    values ('ffffffff-0000-0000-0000-00000000000f',
            'dddddddd-0000-0000-0000-00000000000f','aaaaaaaa-0000-0000-0000-00000000000f')$$,
  '23514', null,
  'a reservation targeting both a location and an asset is rejected');

select lives_ok(
  $$insert into reservations (contact_id, location_id)
    values ('ffffffff-0000-0000-0000-00000000000f','dddddddd-0000-0000-0000-00000000000f')$$,
  'a reservation with exactly one target is accepted');

select * from finish();
rollback;
