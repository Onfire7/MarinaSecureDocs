-- Tests 5-7 of the approved list for Ticket Updates and Incident Updates
-- (2026-10-21): insert-only by policy, Tier 1 for incidents, and scope flags
-- that follow the parent. Every permission check runs both ways.
create extension if not exists pgtap;
begin;
select plan(14);

insert into users (id, name, clerk_user_id, active) values
  ('11111111-0000-4000-8000-0000000000f1', 'Upd Full',  'user_upd_full', true),
  ('11111111-0000-4000-8000-0000000000f2', 'Upd Plain', 'user_upd_plain', true);
insert into roles (id, name, allow) values
  ('22222222-0000-4000-8000-0000000000f1', 'Upd Incidents', array['view_incidents','create_incidents']);
insert into user_roles values ('11111111-0000-4000-8000-0000000000f1', '22222222-0000-4000-8000-0000000000f1');

insert into ticket_statuses (id, name) values ('33333333-0000-4000-8000-0000000000f1', 'Upd Fixture Open');
insert into incident_statuses (id, name) values ('33333333-0000-4000-8000-0000000000f2', 'Upd Fixture Open');
insert into location_types (id, name) values ('44444444-0000-4000-8000-0000000000f1', 'Upd Fixture Type');
insert into locations (id, name, location_type_id) values ('55555555-0000-4000-8000-0000000000f1', 'Upd Slip', '44444444-0000-4000-8000-0000000000f1');
insert into tickets (id, title, status_id, location_id, is_recent)
  values ('66666666-0000-4000-8000-0000000000f1', 'Upd ticket', '33333333-0000-4000-8000-0000000000f1', '55555555-0000-4000-8000-0000000000f1', false);
insert into incidents (id, title, status_id, location_id, is_recent)
  values ('77777777-0000-4000-8000-0000000000f1', 'Upd incident', '33333333-0000-4000-8000-0000000000f2', '55555555-0000-4000-8000-0000000000f1', false);

-- ── 5. ticket_updates is insert-only ─────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_upd_plain"}', true);
set local role authenticated;
select lives_ok(
  $$insert into ticket_updates (id, ticket_id, kind, to_value, author_id)
    values ('88888888-0000-4000-8000-0000000000f1', '66666666-0000-4000-8000-0000000000f1', 'status', 'Open', '11111111-0000-4000-8000-0000000000f2')$$,
  '5. any active user inserts a ticket update');
select is((select count(*) from ticket_updates where id = '88888888-0000-4000-8000-0000000000f1')::int, 1,
  '5. and reads it back');
select is(
  (with u as (update ticket_updates set to_value = 'Rewritten' where id = '88888888-0000-4000-8000-0000000000f1' returning 1) select count(*)::int from u), 0,
  '5. an update touches zero rows: history is written once');
select is(
  (with d as (delete from ticket_updates where id = '88888888-0000-4000-8000-0000000000f1' returning 1) select count(*)::int from d), 0,
  '5. a delete touches zero rows');
select throws_ok(
  $$insert into ticket_updates (ticket_id, kind) values ('66666666-0000-4000-8000-0000000000f1', 'reopened')$$,
  '23514', null, '5. an unknown kind is rejected');
reset role;
select is((select to_value from ticket_updates where id = '88888888-0000-4000-8000-0000000000f1'), 'Open',
  '5. the row is unchanged as owner too');

-- ── 6. incident_updates is Tier 1 ────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_upd_full"}', true);
set local role authenticated;
select lives_ok(
  $$insert into incident_updates (id, incident_id, kind, from_value, to_value, author_id)
    values ('99999999-0000-4000-8000-0000000000f1', '77777777-0000-4000-8000-0000000000f1', 'status', 'Open', 'Closed', '11111111-0000-4000-8000-0000000000f1')$$,
  '6. create_incidents inserts an incident update');
select is((select count(*) from incident_updates where id = '99999999-0000-4000-8000-0000000000f1')::int, 1,
  '6. view_incidents reads it');
select is(
  (with u as (update incident_updates set to_value = 'Open' where id = '99999999-0000-4000-8000-0000000000f1' returning 1) select count(*)::int from u), 0,
  '6. no update, even for the permission holder');
select is(
  (with d as (delete from incident_updates where id = '99999999-0000-4000-8000-0000000000f1' returning 1) select count(*)::int from d), 0,
  '6. no delete, even for the permission holder');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_upd_plain"}', true);
set local role authenticated;
select is((select count(*) from incident_updates where id = '99999999-0000-4000-8000-0000000000f1')::int, 0,
  '6. a user without view_incidents gets zero rows, not an error');
select throws_ok(
  $$insert into incident_updates (incident_id, kind, to_value) values ('77777777-0000-4000-8000-0000000000f1', 'assignee', 'Someone')$$,
  '42501', null, '6. a user without create_incidents cannot insert');
reset role;

-- ── 7. scope flags follow the parent ─────────────────────────────────────
-- Both parents were seeded out of scope; a fresh child defaults to true
-- until the refresh runs, then matches.
select public.refresh_child_sync_scopes();
select is((select is_recent from ticket_updates where id = '88888888-0000-4000-8000-0000000000f1'), false,
  '7. a ticket update takes is_recent from its ticket');
select is((select is_recent from incident_updates where id = '99999999-0000-4000-8000-0000000000f1'), false,
  '7. an incident update takes is_recent from its incident');

select * from finish();
rollback;
