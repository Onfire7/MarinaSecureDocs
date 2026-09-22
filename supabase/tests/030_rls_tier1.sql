-- Tier 1 RLS — the security boundary.
--
-- Every check runs TWICE: once as a user holding the permission, once as a
-- user without it. Denial alone proves nothing; a policy set that denies
-- everyone passes every anonymous-access test, and this codebase has the scars
-- to prove it (CLAUDE.md).
create extension if not exists pgtap;
begin;
select plan(16);

-- Every assertion below is scoped to the fixture rows this file creates.
-- Counting a whole table passes only on an empty database, which is not a
-- property a test should depend on — and running the seed makes it false.

-- ── fixtures (as owner, which bypasses RLS) ──────────────────────────────
insert into users (id, name, clerk_user_id, active) values
  ('11111111-1111-1111-1111-111111111111', 'Alice — sees all', 'user_alice', true),
  ('22222222-2222-2222-2222-222222222222', 'Bob — no roles',   'user_bob',   true),
  ('44444444-4444-4444-4444-444444444444', 'Olive — owner only','user_olive', true),
  ('33333333-3333-3333-3333-333333333333', 'Dana — deactivated','user_dana', false);

insert into roles (id, name, allow) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Full',
    array['view_incidents','create_incidents','view_owner','view_contact',
          'view_lease','manage_lease','view_calls','view_sms','place_calls',
          'edit_owner_contact','manage_roles']),
  ('aaaaaaaa-0000-0000-0000-00000000000b', 'OwnerOnly', array['view_owner']);

insert into user_roles values
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-00000000000a'),
  ('44444444-4444-4444-4444-444444444444','aaaaaaaa-0000-0000-0000-00000000000b'),
  ('33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-00000000000a');

-- Lookup names are unique, and the seed loads real ones. Fixture rows use
-- names that cannot collide with production data.
insert into incident_statuses (id, name) values ('bbbbbbbb-0000-0000-0000-000000000001','Fixture Open');
insert into location_types (id, name) values ('cccccccc-0000-0000-0000-000000000001','Fixture Slip');
insert into locations (id, name, location_type_id)
  values ('dddddddd-0000-0000-0000-000000000001','Slip 14','cccccccc-0000-0000-0000-000000000001');
insert into incidents (id, title, status_id, location_id)
  values ('eeeeeeee-0000-0000-0000-000000000001','Damaged cleat',
          'bbbbbbbb-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001');
insert into contacts (id, name) values ('ffffffff-0000-0000-0000-000000000001','Dana Reyes');
insert into contact_details (contact_id, phone, email)
  values ('ffffffff-0000-0000-0000-000000000001','5551234567','dana@example.com');
insert into leases (id, location_id) values ('99999999-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001');
insert into calls (id, direction, missed) values ('88888888-0000-0000-0000-000000000001','inbound', true);
insert into sms_threads (id) values ('77777777-0000-0000-0000-000000000001');
insert into sms_messages (thread_id, direction, body)
  values ('77777777-0000-0000-0000-000000000001','inbound','hello');
insert into activity_log_entries (event_type, summary, subject_type, subject_id)
  values ('incident.created','Damaged cleat','incidents','eeeeeeee-0000-0000-0000-000000000001');

-- ── incidents ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select is((select count(*) from incidents where id = 'eeeeeeee-0000-0000-0000-000000000001')::int, 1, 'view_incidents holder sees the incident');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
select is((select count(*) from incidents where id = 'eeeeeeee-0000-0000-0000-000000000001')::int, 0,
  'a user without view_incidents gets ZERO ROWS, not an error');
reset role;

-- ── contacts: identity vs reachable details ──────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_olive"}', true);
set local role authenticated;
select is((select count(*) from contacts where id = 'ffffffff-0000-0000-0000-000000000001')::int, 1,
  'view_owner alone shows WHO a contact is');
-- The whole reason contacts was split into two tables. RLS is row-level and
-- cannot hide a column, so the reachable details are a separate row that never
-- reaches the device at all.
select is((select count(*) from contact_details where contact_id = 'ffffffff-0000-0000-0000-000000000001')::int, 0,
  'view_owner WITHOUT view_contact sees no phone or email');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select is((select count(*) from contact_details where contact_id = 'ffffffff-0000-0000-0000-000000000001')::int, 1, 'view_contact holder sees the details');
reset role;

-- ── leases, calls, sms ───────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select is((select count(*) from leases where id = '99999999-0000-0000-0000-000000000001')::int, 1, 'view_lease holder sees the lease');
select is((select count(*) from calls where id = '88888888-0000-0000-0000-000000000001')::int, 1, 'view_calls holder sees the call');
select is((select count(*) from sms_messages where thread_id = '77777777-0000-0000-0000-000000000001')::int, 1, 'view_sms holder sees the message');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
select is((select count(*) from leases where id = '99999999-0000-0000-0000-000000000001')::int, 0, 'no view_lease, no leases');
select is((select count(*) from calls where id = '88888888-0000-0000-0000-000000000001')::int, 0, 'no view_calls, no calls');
select is((select count(*) from sms_messages where thread_id = '77777777-0000-0000-0000-000000000001')::int, 0, 'no view_sms, no messages');
reset role;

-- ── the Activity Log is immutable to every client ────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select is((select count(*) from activity_log_entries where subject_id = 'eeeeeeee-0000-0000-0000-000000000001')::int, 1, 'staff can read the activity log');
-- Alice holds manage_roles — the most privileged thing in the model — and
-- still cannot delete an entry. Only the pg_cron purge removes one.
select throws_ok(
  'delete from activity_log_entries',
  '42501',
  null,
  'even a manage_roles holder cannot delete an activity log entry');
reset role;

-- ── the ADR 0002 privilege-escalation vector ─────────────────────────────
-- Under InstantDB this was a link on a user row whose update rule was
-- per-entity, so any active user could grant themselves an admin role. Here it
-- is an INSERT into a table with its own policy.
select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
select throws_ok(
  $$insert into user_roles values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a')$$,
  '42501',
  null,
  'a user without manage_roles cannot grant themselves a role');
-- NOTE the asymmetry, which cost a red test to discover and is worth keeping
-- in mind everywhere else: an INSERT blocked by WITH CHECK raises 42501, but
-- an UPDATE blocked by USING simply matches no rows and reports success. A
-- client that treats "no error" as "written" would believe this worked. The
-- assertion is therefore that the DATA is unchanged, not that an error came
-- back.
update roles set allow = array['manage_roles'] where name = 'OwnerOnly';
reset role;
select is(
  (select allow from roles where name = 'OwnerOnly'),
  array['view_owner'],
  'a non-holder''s UPDATE of role grants silently changes nothing');

-- ── Tier 0 baseline ──────────────────────────────────────────────────────
-- A deactivated user holds the Full role and still reads nothing anywhere,
-- because current_marina_user_id() resolves to NULL and every policy fails
-- closed on it.
select set_config('request.jwt.claims', '{"sub":"user_dana"}', true);
set local role authenticated;
select is((select count(*) from locations where id = 'dddddddd-0000-0000-0000-000000000001')::int, 0,
  'a deactivated user reads nothing, even from a Tier 0 table');
reset role;

select * from finish();
rollback;
