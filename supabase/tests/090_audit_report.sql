-- Sharing an audit's results: audit_shares, the report functions, and the
-- live-then-snapshot rule (docs/audits.md § Sharing the results). Tests
-- 9-15 of the list approved 2026-09-23. Every permission check runs both
-- ways - as a holder and as a non-holder - because a policy that denies
-- everyone passes every denial test (CLAUDE.md).
create extension if not exists pgtap;
begin;
select plan(37);

-- ── fixtures (as owner, which bypasses RLS; triggers still run) ──────────
insert into users (id, name, clerk_user_id, active) values
  ('22222222-0000-4000-8000-000000000001', 'Rita — audits + locations', 'user_rita', true),
  ('22222222-0000-4000-8000-000000000002', 'Bob — no roles',            'user_bob2', true);
insert into roles (id, name, allow) values
  ('aaaa0000-0000-4000-8000-00000000009a', 'Report Fixture Full', array['manage_audits','manage_locations']);
insert into user_roles (user_id, role_id) values
  ('22222222-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-00000000009a');

insert into location_types (id, name, tracks_status) values
  ('cccc0000-0000-4000-8000-000000000090','Report Fixture Slip', true);
insert into locations (id, name, location_type_id) values
  ('dddd0000-0000-4000-8000-000000000091','RF-S1','cccc0000-0000-4000-8000-000000000090'),
  ('dddd0000-0000-4000-8000-000000000092','RF-S2','cccc0000-0000-4000-8000-000000000090'),
  ('dddd0000-0000-4000-8000-000000000093','RF-S3','cccc0000-0000-4000-8000-000000000090');
insert into services (id, name) values ('55550000-0000-4000-8000-000000000090','Fixture Power');
insert into service_location_types (service_id, location_type_id) values
  ('55550000-0000-4000-8000-000000000090','cccc0000-0000-4000-8000-000000000090');
insert into ticket_statuses (id, name, is_terminal) values
  ('bbbb0000-0000-4000-8000-000000000090','Report Fixture Open', false),
  ('bbbb0000-0000-4000-8000-000000000091','Report Fixture Done', true);

-- R1: a status audit, open while its findings go in, then closed. R2: open.
insert into audits (id, name, kind, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000000b1','Report Fixture Closed','status','22222222-0000-4000-8000-000000000001'),
  ('eeee0000-0000-4000-8000-0000000000b2','Report Fixture Open',  'status','22222222-0000-4000-8000-000000000001');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee2222-0000-4000-8000-000000000001','eeee0000-0000-4000-8000-0000000000b1','dddd0000-0000-4000-8000-000000000091','RF-S1',0),
  ('eeee2222-0000-4000-8000-000000000002','eeee0000-0000-4000-8000-0000000000b1','dddd0000-0000-4000-8000-000000000092','RF-S2',1),
  ('eeee2222-0000-4000-8000-000000000003','eeee0000-0000-4000-8000-0000000000b1','dddd0000-0000-4000-8000-000000000093','RF-S3',2);
insert into audit_findings (id, audit_id, target_id, recorded_by_id, clearly_marked, mapped_correctly, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000e1','eeee0000-0000-4000-8000-0000000000b1','eeee2222-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000001', true, true, now()),
  ('ffff0000-0000-4000-8000-0000000000e2','eeee0000-0000-4000-8000-0000000000b1','eeee2222-0000-4000-8000-000000000002','22222222-0000-4000-8000-000000000001', false, true, now());
insert into audit_finding_services (finding_id, service_id, present, working, note) values
  ('ffff0000-0000-4000-8000-0000000000e1','55550000-0000-4000-8000-000000000090', true, true,  null),
  ('ffff0000-0000-4000-8000-0000000000e2','55550000-0000-4000-8000-000000000090', true, false, 'pedestal dead');
insert into audit_proposals (id, finding_id, kind, structural, payload) values
  ('99990000-0000-4000-8000-0000000000c1','ffff0000-0000-4000-8000-0000000000e2','rename', true, '{"name":"RF-S2A"}');
insert into tickets (id, title, status_id, location_id, source_finding_id) values
  ('77770000-0000-4000-8000-0000000000d1','Pedestal dead at RF-S2','bbbb0000-0000-4000-8000-000000000090',
   'dddd0000-0000-4000-8000-000000000092','ffff0000-0000-4000-8000-0000000000e2');
update audit_targets set state = 'audited' where id in ('eeee2222-0000-4000-8000-000000000001','eeee2222-0000-4000-8000-000000000002');
update audit_targets set state = 'not_audited', not_audited_reason = 'closed early' where id = 'eeee2222-0000-4000-8000-000000000003';
update audits set status = 'closed', closed_at = now() where id = 'eeee0000-0000-4000-8000-0000000000b1';

-- ── 9 · audit_shares is manage_audits only ───────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_rita"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_audit_share('eeee0000-0000-4000-8000-0000000000b1', 'Ownership group', now() + interval '90 days')$$,
  'manage_audits creates a share on a closed audit');
select is((select count(*)::int from audit_shares where audit_id = 'eeee0000-0000-4000-8000-0000000000b1'), 1, 'and reads it back');
select is((select label from audit_shares where audit_id = 'eeee0000-0000-4000-8000-0000000000b1'), 'Ownership group', 'the label is kept');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_bob2"}', true);
set local role authenticated;
select is((select count(*)::int from audit_shares), 0, 'a user without manage_audits sees no shares');
select throws_ok(
  $$select public.create_audit_share('eeee0000-0000-4000-8000-0000000000b1', 'sneaky', null)$$,
  '42501', null, 'and cannot create one');
reset role;

select set_config('request.jwt.claims', '{}', true);
set local role anon;
select is((select count(*)::int from audit_shares), 0, 'anon reads no shares');
select throws_ok(
  $$select public.audit_report_for('eeee0000-0000-4000-8000-0000000000b1')$$,
  '42501', null, 'anon cannot call the in-app report');
reset role;

-- ── 10 · any audit can be shared; an open one is a progress link ─────────
select set_config('request.jwt.claims', '{"sub":"user_rita"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_audit_share('eeee0000-0000-4000-8000-0000000000b2', 'progress', null)$$,
  'an open audit can be shared');
select is(
  (select public.audit_report_for('eeee0000-0000-4000-8000-0000000000b2')->'audit'->>'status'),
  'open', 'and its report says it is open');
select is(
  (select expires_at from public.create_audit_share('eeee0000-0000-4000-8000-0000000000b1', 'forever', null)),
  null::timestamptz, 'a null expiry means never');
reset role;

-- ── 11 · audit_report(key) as anon ───────────────────────────────────────
-- Keys are captured as owner: anon cannot see audit_shares at all, so a
-- lookup made while impersonating it would hand the function null and
-- pass for the wrong reason.
insert into audit_shares (audit_id, label, revoked_at) values
  ('eeee0000-0000-4000-8000-0000000000b1', 'revoked', now());
insert into audit_shares (audit_id, label, expires_at) values
  ('eeee0000-0000-4000-8000-0000000000b1', 'expired', now() - interval '1 day');
create temp table keys as
  select (select key from audit_shares where label = 'Ownership group') as live,
         (select key from audit_shares where label = 'revoked') as revoked,
         (select key from audit_shares where label = 'expired') as expired;
grant select on keys to anon;

select set_config('request.jwt.claims', '{}', true);
set local role anon;
select isnt((select public.audit_report((select live from keys))), null, 'a live key returns the document');
select is((select public.audit_report(gen_random_uuid())), null, 'an unknown key returns null');
select is((select public.audit_report((select revoked from keys))), null, 'a revoked key returns null');
select is((select public.audit_report((select expired from keys))), null, 'an expired key returns null');
reset role;
select is((select view_count from audit_shares where label = 'Ownership group'), 1, 'a view is counted');
select isnt((select last_viewed_at from audit_shares where label = 'Ownership group'), null, 'and stamped');
select is((select view_count from audit_shares where label = 'revoked'), 0, 'a refused view is not counted');

-- ── 12 · the document ────────────────────────────────────────────────────
create temp table doc as select public.audit_report_document('eeee0000-0000-4000-8000-0000000000b1') as d;
select is((select d->'audit'->>'name' from doc), 'Report Fixture Closed', 'the audit name');
select is((select d->'columns'->'services' from doc), '["Fixture Power"]'::jsonb, 'services valid for the targets'' type are the columns');
select is((select (d->'targets'->1->'services'->0->>'working')::boolean from doc), false, 'a service found not working is in the row');
select is((select d->'targets'->1->'services'->0->>'note' from doc), 'pedestal dead', 'with its note');
select is((select d->'targets'->2->>'state' from doc), 'not_audited', 'a target not reached is in the row, as such');
select is((select d->'targets'->1->'proposals'->0->>'kind' from doc), 'rename', 'the proposal is in the row');
select is((select (d->'targets'->1->'tickets'->0->>'open')::boolean from doc), true, 'the ticket is open');
select ok(
  (select d::text !~ '"contact' and d::text !~ '"boat' and d::text !~ '"vehicle' and d::text !~ '"gps' and d::text !~ '"lat"' and d::text !~ '"gaps"' from doc),
  'no contact, boat, vehicle, coordinate or gap keys anywhere in it');

-- ── 13 · live while closed ───────────────────────────────────────────────
update audit_proposals set decision = 'approved', decided_at = now(), decided_by_id = '22222222-0000-4000-8000-000000000001'
 where id = '99990000-0000-4000-8000-0000000000c1';
select is(
  (select public.audit_report_document('eeee0000-0000-4000-8000-0000000000b1')->'targets'->1->'proposals'->0->>'decision'),
  'approved', 'a decision made after the share shows on the next read');
select ok(
  (select (public.audit_report_document('eeee0000-0000-4000-8000-0000000000b1')->>'asOf')::timestamptz > (d->>'asOf')::timestamptz from doc),
  'and the as-of stamp moves');

-- ── 14 · static after finalize ───────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_rita"}', true);
set local role authenticated;
select lives_ok($$select public.finalize_audit('eeee0000-0000-4000-8000-0000000000b1')$$, 'finalize');
reset role;
select is((select count(*)::int from audit_report_snapshots where audit_id = 'eeee0000-0000-4000-8000-0000000000b1'), 1, 'finalize stored the snapshot');
update tickets set status_id = 'bbbb0000-0000-4000-8000-000000000091' where id = '77770000-0000-4000-8000-0000000000d1';
select is(
  (select (public.audit_report_document('eeee0000-0000-4000-8000-0000000000b1')->'targets'->1->'tickets'->0->>'open')::boolean),
  true, 'closing the ticket afterwards does not change the report');
-- The snapshot table is closed to authenticated, so the comparison value is
-- captured as owner and only the function call runs as Bob.
create temp table snap as select document from audit_report_snapshots where audit_id = 'eeee0000-0000-4000-8000-0000000000b1';
grant select on snap to authenticated;
select set_config('request.jwt.claims', '{"sub":"user_bob2"}', true);
set local role authenticated;
select is(
  (select public.audit_report_for('eeee0000-0000-4000-8000-0000000000b1')),
  (select document from snap),
  'the in-app read is the same snapshot, and any active user may read it');
select throws_ok(
  $$select document from audit_report_snapshots$$,
  '42501', null, 'and nobody reads the snapshot table directly');
reset role;

-- ── 15 · revoke ──────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_bob2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.revoke_audit_share((select id from audit_shares where label = 'forever'))$$,
  '42501', null, 'a user without manage_audits cannot revoke');
reset role;
select set_config('request.jwt.claims', '{"sub":"user_rita"}', true);
set local role authenticated;
select lives_ok($$select public.revoke_audit_share((select id from audit_shares where label = 'forever'))$$, 'manage_audits revokes');
reset role;
select isnt((select revoked_at from audit_shares where label = 'forever'), null, 'revoked_at is set');
create temp table stamp as select revoked_at from audit_shares where label = 'forever';
select set_config('request.jwt.claims', '{"sub":"user_rita"}', true);
set local role authenticated;
select lives_ok($$select public.revoke_audit_share((select id from audit_shares where label = 'forever'))$$, 'revoking again is harmless');
reset role;
select is((select revoked_at from audit_shares where label = 'forever'), (select revoked_at from stamp), 'and never clears or moves the stamp');

select * from finish();
rollback;
