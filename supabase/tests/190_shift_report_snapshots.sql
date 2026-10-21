-- Tests 9-10 of the approved list for the Shift Report (2026-10-21): the
-- snapshot is written once, and the public RPC serves it to anon with only
-- what moved since End of Shift, and nothing else to anon.
create extension if not exists pgtap;
begin;
select plan(13);

insert into users (id, name, clerk_user_id, active) values
  ('11111111-0000-4000-8000-0000000000a1', 'Snap Guard', 'user_snap_guard', true);
insert into ticket_statuses (id, name) values ('33333333-0000-4000-8000-0000000000a1', 'Snap Open');
insert into incident_statuses (id, name) values ('33333333-0000-4000-8000-0000000000a2', 'Snap Open');
insert into location_types (id, name) values ('44444444-0000-4000-8000-0000000000a1', 'Snap Type');
insert into locations (id, name, location_type_id) values ('55555555-0000-4000-8000-0000000000a1', 'Snap Slip', '44444444-0000-4000-8000-0000000000a1');
insert into shifts (id, guard_id, started_at, ended_at, is_recent) values
  ('66666666-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-0000000000a1', now() - interval '9 hours', now() - interval '1 hour', false),
  ('66666666-0000-4000-8000-0000000000a2', '11111111-0000-4000-8000-0000000000a1', now() - interval '2 hours', null, true);
insert into incidents (id, title, status_id, location_id, author_id, created_at)
  values ('77777777-0000-4000-8000-0000000000a1', 'Snap incident', '33333333-0000-4000-8000-0000000000a2', '55555555-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-0000000000a1', now() - interval '5 hours');
insert into tickets (id, title, status_id, location_id, created_by_id, created_at)
  values ('88888888-0000-4000-8000-0000000000a1', 'Snap ticket', '33333333-0000-4000-8000-0000000000a1', '55555555-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-0000000000a1', now() - interval '4 hours');
-- One update before End of Shift, one after, for each record.
insert into incident_comments (incident_id, body, created_at, author_id) values
  ('77777777-0000-4000-8000-0000000000a1', 'before', now() - interval '3 hours', '11111111-0000-4000-8000-0000000000a1'),
  ('77777777-0000-4000-8000-0000000000a1', 'after',  now() - interval '30 minutes', '11111111-0000-4000-8000-0000000000a1');
insert into ticket_updates (ticket_id, kind, from_value, to_value, created_at) values
  ('88888888-0000-4000-8000-0000000000a1', 'status', 'Snap Open', 'Resolved', now() - interval '20 minutes'),
  ('88888888-0000-4000-8000-0000000000a1', 'priority', 'Low', 'High', now() - interval '3 hours');

-- ── 9. the snapshot is written once ──────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_snap_guard"}', true);
set local role authenticated;
select lives_ok(
  $$insert into shift_report_snapshots (shift_id, document) values ('66666666-0000-4000-8000-0000000000a1',
    '{"version":1,"incidents":[{"id":"77777777-0000-4000-8000-0000000000a1"}],"tickets":[{"id":"88888888-0000-4000-8000-0000000000a1"}]}')$$,
  '9. an active user inserts the snapshot');
select throws_ok(
  $$insert into shift_report_snapshots (shift_id, document) values ('66666666-0000-4000-8000-0000000000a1', '{}')$$,
  '23505', null, '9. a second snapshot for the same shift is refused');
select is(
  (with u as (update shift_report_snapshots set document = '{}' where shift_id = '66666666-0000-4000-8000-0000000000a1' returning 1) select count(*)::int from u), 0,
  '9. an update touches zero rows');
select is(
  (with d as (delete from shift_report_snapshots where shift_id = '66666666-0000-4000-8000-0000000000a1' returning 1) select count(*)::int from d), 0,
  '9. a delete touches zero rows');
reset role;
select public.refresh_child_sync_scopes();
select is((select is_recent from shift_report_snapshots where shift_id = '66666666-0000-4000-8000-0000000000a1'), false,
  '9. the snapshot takes is_recent from its shift');

-- ── 10. the public RPC ───────────────────────────────────────────────────
set local role anon;
select is((select public.shift_report('66666666-0000-4000-8000-0000000000a1')->>'status'), 'ended',
  '10. anon reads an ended shift as ended');
select is((select public.shift_report('66666666-0000-4000-8000-0000000000a1')->'document'->>'version'), '1',
  '10. with its document');
select is((select jsonb_array_length(public.shift_report('66666666-0000-4000-8000-0000000000a1')->'updates'->'incidentComments')), 1,
  '10. only the addendum after End of Shift comes back');
select is((select public.shift_report('66666666-0000-4000-8000-0000000000a1')->'updates'->'ticketUpdates'->0->>'kind'), 'status',
  '10. only the ticket update after End of Shift comes back');
select is((select public.shift_report('66666666-0000-4000-8000-0000000000a2')->>'status'), 'not_ended',
  '10. a shift with no snapshot is not_ended');
select is((select public.shift_report('66666666-0000-4000-8000-0000000000a2')->'header'->>'guardName'), 'Snap Guard',
  '10. with only its header');
select is((select public.shift_report('66666666-0000-4000-8000-0000000000ff')), null,
  '10. an unknown id is null');
select throws_ok(
  $$select count(*) from shift_report_snapshots$$,
  '42501', null, '10. anon cannot read the snapshots directly');
reset role;

select * from finish();
rollback;
