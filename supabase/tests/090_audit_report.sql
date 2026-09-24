-- Sharing an audit's results: audit_shares, the report functions, and the
-- live-then-snapshot rule (docs/audits.md § Sharing the results). Tests
-- 9-15 of the list approved 2026-09-23. Every permission check runs both
-- ways - as a holder and as a non-holder - because a policy that denies
-- everyone passes every denial test (CLAUDE.md).
create extension if not exists pgtap;
begin;
select plan(55);

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

-- ── a link can show less (docs/audits.md § A link can show less) ─────────
-- Its own audit, its own catalogue: the filter tests need two Services to
-- tell "hide one" from "hide the category", and the fixture above asserts
-- on a one-Service column list.
insert into location_types (id, name, tracks_status) values
  ('cccc0000-0000-4000-8000-000000000094','Filter Fixture Site', true);
insert into locations (id, name, location_type_id) values
  ('dddd0000-0000-4000-8000-000000000095','FF-Loop','cccc0000-0000-4000-8000-000000000094');
insert into locations (id, name, location_type_id, parent_id) values
  ('dddd0000-0000-4000-8000-000000000096','FF-1','cccc0000-0000-4000-8000-000000000094','dddd0000-0000-4000-8000-000000000095'),
  ('dddd0000-0000-4000-8000-000000000097','FF-2','cccc0000-0000-4000-8000-000000000094','dddd0000-0000-4000-8000-000000000095'),
  ('dddd0000-0000-4000-8000-000000000098','FF-3','cccc0000-0000-4000-8000-000000000094','dddd0000-0000-4000-8000-000000000095');
insert into services (id, name) values
  ('55550000-0000-4000-8000-000000000094','Filter Power'),
  ('55550000-0000-4000-8000-000000000095','Filter Water');
insert into service_location_types (service_id, location_type_id) values
  ('55550000-0000-4000-8000-000000000094','cccc0000-0000-4000-8000-000000000094'),
  ('55550000-0000-4000-8000-000000000095','cccc0000-0000-4000-8000-000000000094');
insert into amenities (id, name) values ('66660000-0000-4000-8000-000000000094','Filter WiFi');
insert into amenity_location_types (amenity_id, location_type_id) values
  ('66660000-0000-4000-8000-000000000094','cccc0000-0000-4000-8000-000000000094');
insert into attributes (id, name, unit) values ('aaaa0000-0000-4000-8000-000000000094','Filter Length','ft');
insert into attribute_location_types (attribute_id, location_type_id) values
  ('aaaa0000-0000-4000-8000-000000000094','cccc0000-0000-4000-8000-000000000094');

insert into audits (id, name, kind, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000000b3','Filter Fixture','status','22222222-0000-4000-8000-000000000001');
insert into audit_rules (id, audit_id, position) values
  ('11110000-0000-4000-8000-000000000094','eeee0000-0000-4000-8000-0000000000b3',0);
insert into audit_questions (id, rule_id, position, prompt) values
  ('22220000-0000-4000-8000-000000000094','11110000-0000-4000-8000-000000000094',0,'Is the fire ring clear?');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee2222-0000-4000-8000-000000000011','eeee0000-0000-4000-8000-0000000000b3','dddd0000-0000-4000-8000-000000000096','FF-1',0),
  ('eeee2222-0000-4000-8000-000000000012','eeee0000-0000-4000-8000-0000000000b3','dddd0000-0000-4000-8000-000000000097','FF-2',1),
  ('eeee2222-0000-4000-8000-000000000013','eeee0000-0000-4000-8000-0000000000b3','dddd0000-0000-4000-8000-000000000098','FF-3',2);
insert into audit_findings (id, audit_id, target_id, recorded_by_id, clearly_marked, mapped_correctly, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000e4','eeee0000-0000-4000-8000-0000000000b3','eeee2222-0000-4000-8000-000000000011','22222222-0000-4000-8000-000000000001', true, true, now()),
  ('ffff0000-0000-4000-8000-0000000000e5','eeee0000-0000-4000-8000-0000000000b3','eeee2222-0000-4000-8000-000000000012','22222222-0000-4000-8000-000000000001', false, true, now()),
  ('ffff0000-0000-4000-8000-0000000000e6','eeee0000-0000-4000-8000-0000000000b3','eeee2222-0000-4000-8000-000000000013','22222222-0000-4000-8000-000000000001', true, true, now());
insert into audit_finding_services (finding_id, service_id, present, working, note) values
  ('ffff0000-0000-4000-8000-0000000000e4','55550000-0000-4000-8000-000000000094', true, true, null),
  ('ffff0000-0000-4000-8000-0000000000e4','55550000-0000-4000-8000-000000000095', true, false, 'tap drips'),
  ('ffff0000-0000-4000-8000-0000000000e5','55550000-0000-4000-8000-000000000094', true, true, null);
insert into audit_finding_amenities (finding_id, amenity_id, present, note) values
  ('ffff0000-0000-4000-8000-0000000000e4','66660000-0000-4000-8000-000000000094', true, null);
insert into audit_finding_answers (finding_id, question_id, value) values
  ('ffff0000-0000-4000-8000-0000000000e4','22220000-0000-4000-8000-000000000094','false'::jsonb);
insert into audit_proposals (id, finding_id, kind, structural, payload, decision, decided_by_id) values
  ('99990000-0000-4000-8000-0000000000c4','ffff0000-0000-4000-8000-0000000000e4','set_gps', false,
   '{"lat":33.8,"lng":-96.6,"accuracy":4}', 'approved','22222222-0000-4000-8000-000000000001'),
  ('99990000-0000-4000-8000-0000000000c5','ffff0000-0000-4000-8000-0000000000e4','set_attribute', false,
   '{"attribute_id":"aaaa0000-0000-4000-8000-000000000094","value":38,"text":null}', 'approved','22222222-0000-4000-8000-000000000001'),
  ('99990000-0000-4000-8000-0000000000c6','ffff0000-0000-4000-8000-0000000000e5','rename', true,
   '{"name":"FF-2A"}', 'approved','22222222-0000-4000-8000-000000000001');
insert into tickets (id, title, status_id, location_id, source_finding_id) values
  ('77770000-0000-4000-8000-0000000000d4','Tap drips at FF-1','bbbb0000-0000-4000-8000-000000000090',
   'dddd0000-0000-4000-8000-000000000096','ffff0000-0000-4000-8000-0000000000e4');
update audits set status = 'closed', closed_at = now() where id = 'eeee0000-0000-4000-8000-0000000000b3';

select set_config('request.jwt.claims', '{"sub":"user_rita"}', true);
set local role authenticated;
create temp table fkeys as
select
  (public.create_audit_share('eeee0000-0000-4000-8000-0000000000b3','plain', null, '{}'::jsonb)).key           as plain,
  (public.create_audit_share('eeee0000-0000-4000-8000-0000000000b3','no services', null,
     '{"categories":["services"]}'::jsonb)).key                                                                as no_svc,
  (public.create_audit_share('eeee0000-0000-4000-8000-0000000000b3','no water', null,
     '{"services":["55550000-0000-4000-8000-000000000095"]}'::jsonb)).key                                      as no_water,
  (public.create_audit_share('eeee0000-0000-4000-8000-0000000000b3','no question', null,
     '{"questions":["22220000-0000-4000-8000-000000000094"]}'::jsonb)).key                                     as no_q,
  (public.create_audit_share('eeee0000-0000-4000-8000-0000000000b3','no marked', null,
     '{"categories":["marked"]}'::jsonb)).key                                                                  as no_marked,
  (public.create_audit_share('eeee0000-0000-4000-8000-0000000000b3','no gps', null,
     '{"categories":["gps"]}'::jsonb)).key                                                                     as no_gps,
  (public.create_audit_share('eeee0000-0000-4000-8000-0000000000b3','two sites', null,
     '{"targets":["eeee2222-0000-4000-8000-000000000011","eeee2222-0000-4000-8000-000000000012"]}'::jsonb)).key as two,
  (public.create_audit_share('eeee0000-0000-4000-8000-0000000000b3','renamed later', null,
     '{"services":["55550000-0000-4000-8000-000000000095"]}'::jsonb)).key                                      as renamed;
reset role;
grant select on fkeys to anon, authenticated;

-- 19 · an empty filter changes nothing
select is(
  (select public.audit_report((select plain from fkeys)) #- '{asOf}'),
  (select public.audit_report_for('eeee0000-0000-4000-8000-0000000000b3') #- '{asOf}'),
  'an empty filter is the whole report');

-- 20 · a hidden category takes its column, its flag and every entry
select is(
  (select public.audit_report((select no_svc from fkeys)) -> 'columns' -> 'services'), '[]'::jsonb,
  'hiding Services empties the column list');
select is(
  (select (public.audit_report((select no_svc from fkeys)) -> 'audit' ->> 'includeServices')::boolean), false,
  'and clears the flag, so the reader cannot tell it was asked');
select is(
  (select jsonb_array_length(jsonb_path_query_array(public.audit_report((select no_svc from fkeys)), '$.targets[*].services[*]'))),
  0, 'and no location carries a service');

-- 21 · one entry, not the category
select is(
  (select public.audit_report((select no_water from fkeys)) -> 'columns' -> 'services'), '["Filter Power"]'::jsonb,
  'hiding one Service leaves the other in the columns');
select is(
  (select jsonb_path_query_array(public.audit_report((select no_water from fkeys)), '$.targets[*].services[*].name')),
  '["Filter Power","Filter Power"]'::jsonb,
  'and leaves it on every location that recorded it');

-- 22 · a question goes from the columns and from every answer
select is(
  (select public.audit_report((select no_q from fkeys)) -> 'columns' -> 'questions'), '[]'::jsonb,
  'hiding a Question empties the column list');
select is(
  (select jsonb_array_length(jsonb_path_query_array(public.audit_report((select no_q from fkeys)), '$.targets[*].answers[*]'))),
  0, 'and takes its answers with it');

-- 23 · marked is a finding field, not a column
select is(
  (select jsonb_path_query_array(public.audit_report((select no_marked from fkeys)), '$.targets[*].finding.clearlyMarked')),
  '[null, null, null]'::jsonb, 'hiding Marked nulls it on every finding');
select is(
  (select (public.audit_report((select no_marked from fkeys)) -> 'audit' ->> 'includeMarked')::boolean), false,
  'and clears the flag');

-- 24 · GPS is the set_gps changes, and only those
select is(
  (select jsonb_path_query_array(public.audit_report((select no_gps from fkeys)), '$.targets[*].proposals[*].kind')),
  '["set_attribute","rename"]'::jsonb,
  'hiding GPS drops the fix and leaves every other change');

-- 25 · locations, and the totals are of that subset
select is(
  (select jsonb_path_query_array(public.audit_report((select two from fkeys)), '$.targets[*].name')),
  '["FF-1","FF-2"]'::jsonb, 'a link narrowed to two locations carries two');

-- 26 · ids, not names: a rename must not un-hide what was hidden
update services set name = 'Filter Water (potable)' where id = '55550000-0000-4000-8000-000000000095';
select is(
  (select public.audit_report((select renamed from fkeys)) -> 'columns' -> 'services'), '["Filter Power"]'::jsonb,
  'renaming a hidden Service does not un-hide it');
update services set name = 'Filter Water' where id = '55550000-0000-4000-8000-000000000095';

-- 27 · the in-app report is the audit itself
select is(
  (select jsonb_array_length(public.audit_report_for('eeee0000-0000-4000-8000-0000000000b3') -> 'columns' -> 'services')),
  2, 'the in-app report is never filtered');

-- 28 · a filtered link is still a link
select set_config('request.jwt.claims', '{"sub":"user_rita"}', true);
set local role authenticated;
select public.revoke_audit_share((select id from audit_shares where label = 'no gps'));
reset role;
select is((select public.audit_report((select no_gps from fkeys))), null,
  'revoking a filtered link refuses it like any other');

-- ── which Locations have since been removed ─────────────────────────────
-- Tests 4 and 5 of the list approved 2026-09-24. A report that lists a
-- retired Location as though it were still there sends a reader to look at
-- something that is gone.
update locations set retired_at = now() where id = 'dddd0000-0000-4000-8000-000000000097';
select is(
  (select jsonb_path_query_array(public.audit_report_for('eeee0000-0000-4000-8000-0000000000b3'),
                                 '$.targets[*].retiredAt') @> '[null]'::jsonb), true,
  'a Location still standing carries no removal date');
select ok(
  (select public.audit_report_for('eeee0000-0000-4000-8000-0000000000b3')
            #>> '{targets,1,retiredAt}') is not null,
  'and one that has been removed carries the date it went');

-- The Audit finalized earlier in this file has a stored snapshot. A removal
-- after that must not reach back into it: a finalized report never changes.
update locations set retired_at = now() where id = 'dddd0000-0000-4000-8000-000000000091';
select is(
  (select public.audit_report_for('eeee0000-0000-4000-8000-0000000000b1') #>> '{targets,0,retiredAt}'),
  null,
  'a finalized report is the snapshot, and does not start striking rows out later');

select * from finish();
rollback;
