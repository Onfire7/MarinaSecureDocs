-- Location audits: the invariants that moved into the database.
--
-- docs/audits.md is the spec. Every permission check here runs both ways —
-- as a holder and as a non-holder — because a policy that denies everyone
-- passes every denial test (CLAUDE.md).
create extension if not exists pgtap;
begin;
select plan(51);

-- Rows affected by an UPDATE run as the current role, so RLS is exercised
-- from the caller's side. A data-modifying CTE cannot sit inside is().
create function pg_temp.upd_count(sql text) returns int language plpgsql as $$
declare n int;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── fixtures (as owner, which bypasses RLS; triggers still run) ──────────
insert into users (id, name, clerk_user_id, active) values
  ('11111111-0000-4000-8000-000000000001', 'Alice — audits + locations', 'user_alice', true),
  ('11111111-0000-4000-8000-000000000002', 'Bob — no roles',             'user_bob',   true),
  ('11111111-0000-4000-8000-000000000003', 'Carl — audits only',         'user_carl',  true);
insert into roles (id, name, allow) values
  ('aaaa0000-0000-4000-8000-00000000008a', 'Audit Full', array['manage_audits','manage_locations']),
  ('aaaa0000-0000-4000-8000-00000000008b', 'Audit Only', array['manage_audits']);
insert into user_roles (user_id, role_id) values
  ('11111111-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-00000000008a'),
  ('11111111-0000-4000-8000-000000000003','aaaa0000-0000-4000-8000-00000000008b');

insert into location_types (id, name, tracks_status) values
  ('cccc0000-0000-4000-8000-000000000080','Audit Fixture Slip', true);
insert into locations (id, name, location_type_id) values
  ('dddd0000-0000-4000-8000-000000000081','AF-S1','cccc0000-0000-4000-8000-000000000080'),
  ('dddd0000-0000-4000-8000-000000000082','AF-S2','cccc0000-0000-4000-8000-000000000080'),
  ('dddd0000-0000-4000-8000-000000000083','AF-S3','cccc0000-0000-4000-8000-000000000080'),
  ('dddd0000-0000-4000-8000-000000000084','AF-S4','cccc0000-0000-4000-8000-000000000080');
-- S1 has history (a note); S4 has none.
insert into notes (body, location_id) values ('cleat loose', 'dddd0000-0000-4000-8000-000000000081');
insert into ticket_statuses (id, name) values ('bbbb0000-0000-4000-8000-000000000080','Audit Fixture Open');

insert into audit_templates (id, name, kind) values
  ('eeee0000-0000-4000-8000-000000000080','Fixture Template','occupancy');

-- Audit A1: open, targets S1..S4. Audit A2: open, targets S1 and S4.
insert into audits (id, name, kind, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000000a1','Fixture Audit One','occupancy','11111111-0000-4000-8000-000000000001'),
  ('eeee0000-0000-4000-8000-0000000000a2','Fixture Audit Two','occupancy','11111111-0000-4000-8000-000000000001');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee1111-0000-4000-8000-000000000001','eeee0000-0000-4000-8000-0000000000a1','dddd0000-0000-4000-8000-000000000081','AF-S1',0),
  ('eeee1111-0000-4000-8000-000000000002','eeee0000-0000-4000-8000-0000000000a1','dddd0000-0000-4000-8000-000000000082','AF-S2',1),
  ('eeee1111-0000-4000-8000-000000000003','eeee0000-0000-4000-8000-0000000000a1','dddd0000-0000-4000-8000-000000000083','AF-S3',2),
  ('eeee1111-0000-4000-8000-000000000004','eeee0000-0000-4000-8000-0000000000a1','dddd0000-0000-4000-8000-000000000084','AF-S4',3),
  ('eeee1111-0000-4000-8000-000000000005','eeee0000-0000-4000-8000-0000000000a2','dddd0000-0000-4000-8000-000000000081','AF-S1',0),
  ('eeee1111-0000-4000-8000-000000000006','eeee0000-0000-4000-8000-0000000000a2','dddd0000-0000-4000-8000-000000000084','AF-S4',1);

-- Alice's findings: S1 (retire + GPS proposals), S4 (retire), and a proposed
-- new location with a ticket already raised against the stand-in parent S3.
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000f1','eeee0000-0000-4000-8000-0000000000a1','eeee1111-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001', now()),
  ('ffff0000-0000-4000-8000-0000000000f2','eeee0000-0000-4000-8000-0000000000a1','eeee1111-0000-4000-8000-000000000004','11111111-0000-4000-8000-000000000001', now()),
  ('ffff0000-0000-4000-8000-0000000000f4','eeee0000-0000-4000-8000-0000000000a1', null,                                   '11111111-0000-4000-8000-000000000001', now());
insert into audit_proposals (id, finding_id, kind, payload) values
  ('99990000-0000-4000-8000-0000000000b1','ffff0000-0000-4000-8000-0000000000f1','retire_location','{}'),
  ('99990000-0000-4000-8000-0000000000b2','ffff0000-0000-4000-8000-0000000000f1','set_gps','{"lat": 33.1, "lng": -96.2}'),
  ('99990000-0000-4000-8000-0000000000b3','ffff0000-0000-4000-8000-0000000000f4','create_location',
     '{"name":"AF-New Slip","location_type_id":"cccc0000-0000-4000-8000-000000000080","parent_id":null}'),
  ('99990000-0000-4000-8000-0000000000b4','ffff0000-0000-4000-8000-0000000000f2','retire_location','{}');
insert into tickets (id, title, status_id, location_id, proposal_id) values
  ('77770000-0000-4000-8000-0000000000c1','Pedestal dead at new slip','bbbb0000-0000-4000-8000-000000000080',
   'dddd0000-0000-4000-8000-000000000083','99990000-0000-4000-8000-0000000000b3');

-- ── constraints ──────────────────────────────────────────────────────────
select throws_ok(
  $$insert into audit_rules (template_id, audit_id) values
      ('eeee0000-0000-4000-8000-000000000080','eeee0000-0000-4000-8000-0000000000a1')$$,
  '23514', null, 'audit_rules needs exactly one owner (both given)');
select throws_ok(
  $$insert into audit_assignees (audit_id) values ('eeee0000-0000-4000-8000-0000000000a1')$$,
  '23514', null, 'audit_assignees needs exactly one of user or role');
select throws_ok(
  $$insert into audit_targets (audit_id, location_id, location_name) values
      ('eeee0000-0000-4000-8000-0000000000a1','dddd0000-0000-4000-8000-000000000081','AF-S1')$$,
  '23505', null, 'one target per location per audit');
select throws_ok(
  $$insert into audit_findings (audit_id, target_id, recorded_by_id) values
      ('eeee0000-0000-4000-8000-0000000000a1','eeee1111-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000002')$$,
  '23505', null, 'one finding per target');
select throws_ok(
  $$update audit_proposals set decision = 'rejected' where id = '99990000-0000-4000-8000-0000000000b2'$$,
  '23514', null, 'rejecting a proposal requires a reason');

-- ── manage_audits alone cannot decide a structural proposal ─────────────
select set_config('request.jwt.claims', '{"sub":"user_carl"}', true);
set local role authenticated;
select is(pg_temp.upd_count($u$update audit_proposals set decision = 'approved', decided_by_id = '11111111-0000-4000-8000-000000000003' where id = '99990000-0000-4000-8000-0000000000b1'$u$), 0,
  'manage_audits alone updates ZERO structural proposals');
select is(pg_temp.upd_count($u$update audit_proposals set decision = 'approved', decided_by_id = '11111111-0000-4000-8000-000000000003' where id = '99990000-0000-4000-8000-0000000000b2'$u$), 1,
  'manage_audits alone decides a non-structural proposal');
reset role;

-- ── any active user may record a finding; only its author may change it ──
select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
select lives_ok(
  $$insert into audit_findings (id, audit_id, target_id, recorded_by_id, occupied) values
      ('ffff0000-0000-4000-8000-0000000000f3','eeee0000-0000-4000-8000-0000000000a1',
       'eeee1111-0000-4000-8000-000000000003','11111111-0000-4000-8000-000000000002', true)$$,
  'a user with no roles at all records a finding');
reset role;
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select is(pg_temp.upd_count($u$update audit_findings set occupied = false where id = 'ffff0000-0000-4000-8000-0000000000f3'$u$), 0, 'someone else — even with every permission — cannot edit it');
reset role;
select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
select is(pg_temp.upd_count($u$update audit_findings set occupied = false where id = 'ffff0000-0000-4000-8000-0000000000f3'$u$), 1, 'the author edits their own finding while the audit is open');
reset role;

-- ── the last finding's parts arrive after the audit auto-closed ─────────
insert into audits (id, name, kind, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000000a3','Fixture Audit Three','status','11111111-0000-4000-8000-000000000001');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee1111-0000-4000-8000-000000000007','eeee0000-0000-4000-8000-0000000000a3','dddd0000-0000-4000-8000-000000000083','AF-S3',0);
select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000f5','eeee0000-0000-4000-8000-0000000000a3',
   'eeee1111-0000-4000-8000-000000000007','11111111-0000-4000-8000-000000000002', now());
reset role;
select is((select status::text from audits where id = 'eeee0000-0000-4000-8000-0000000000a3'), 'closed',
  'a confirmed finding on the only pending target closes the audit');
select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
select lives_ok(
  $$insert into audit_proposals (finding_id, kind, payload) values
      ('ffff0000-0000-4000-8000-0000000000f5','set_gps','{"lat":1,"lng":2,"accuracy":5}')$$,
  'the author still writes that finding''s proposal after the audit closed under it');
reset role;

-- ── closing early, and a closed audit refuses findings ──────────────────
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select close_audit('eeee0000-0000-4000-8000-0000000000a1');
reset role;
select is((select state::text || '/' || not_audited_reason from audit_targets where id = 'eeee1111-0000-4000-8000-000000000002'),
  'not_audited/closed early', 'closing early marks the remaining target Not Audited');
select is((select status::text from audits where id = 'eeee0000-0000-4000-8000-0000000000a1'), 'closed', 'the audit is closed');
select throws_ok(
  $$insert into audit_findings (audit_id, target_id, recorded_by_id) values
      ('eeee0000-0000-4000-8000-0000000000a1','eeee1111-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000002')$$,
  '23514', null, 'a closed audit rejects new findings, even from the owner');

-- ── finalize refuses while anything is undecided ────────────────────────
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select throws_ok($$select finalize_audit('eeee0000-0000-4000-8000-0000000000a1')$$, '23514', null,
  'finalize_audit refuses while any proposal is undecided');
select is(pg_temp.upd_count($u$update audit_proposals set decision = 'approved', decided_by_id = '11111111-0000-4000-8000-000000000001' where id in ('99990000-0000-4000-8000-0000000000b1','99990000-0000-4000-8000-0000000000b3','99990000-0000-4000-8000-0000000000b4')$u$), 3,
  'manage_locations decides the structural proposals');
reset role;

-- ── finalize refuses structural approvals from a user without manage_locations
select set_config('request.jwt.claims', '{"sub":"user_carl"}', true);
set local role authenticated;
select throws_ok($$select finalize_audit('eeee0000-0000-4000-8000-0000000000a1')$$, '42501', null,
  'manage_audits alone cannot finalize an audit carrying approved structural proposals');
reset role;

-- ── finalize applies: create + re-target, retire vs delete, other audits ─
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select lives_ok($$select finalize_audit('eeee0000-0000-4000-8000-0000000000a1')$$, 'finalize_audit succeeds with every proposal decided');
reset role;
select is((select count(*) from locations where name = 'AF-New Slip')::int, 1, 'an approved create_location makes the location');
select is((select t.location_id from tickets t where t.id = '77770000-0000-4000-8000-0000000000c1'),
          (select applied_location_id from audit_proposals where id = '99990000-0000-4000-8000-0000000000b3'),
  'the ticket raised against the proposed location is re-targeted to it');
select ok((select retired_at is not null from locations where id = 'dddd0000-0000-4000-8000-000000000081'),
  'a location with history is retired, not deleted');
select is((select count(*) from locations where id = 'dddd0000-0000-4000-8000-000000000084')::int, 0,
  'a location with no history is deleted');
select ok((select state = 'not_audited' and not_audited_reason like 'retired by Audit "Fixture Audit One"%'
             from audit_targets where id = 'eeee1111-0000-4000-8000-000000000006'),
  'retiring a location marks it Not Audited in every other open audit, naming the audit');

-- ── occupancy on the occupant (ADR 0006) ─────────────────────────────────
insert into boats (id, name, location_id) values
  ('55550000-0000-4000-8000-0000000000b1','Fixture Boat A','dddd0000-0000-4000-8000-000000000083'),
  ('55550000-0000-4000-8000-0000000000b2','Fixture Boat B','dddd0000-0000-4000-8000-000000000083');
select is((select count(*) from boats where location_id = 'dddd0000-0000-4000-8000-000000000083')::int, 2,
  'two boats may share a location');

-- ── sync scope: finalized audits leave scope after 30 days ──────────────
select refresh_sync_scopes_all();
select ok((select is_current from audits where id = 'eeee0000-0000-4000-8000-0000000000a1'),
  'a just-finalized audit is still in scope');
update audits set finalized_at = now() - interval '31 days' where id = 'eeee0000-0000-4000-8000-0000000000a1';
select refresh_sync_scopes_all();
select ok((select not is_current from audits where id = 'eeee0000-0000-4000-8000-0000000000a1'),
  'a month after finalize the audit leaves scope');
select ok((select not is_current from audit_findings where id = 'ffff0000-0000-4000-8000-0000000000f1'),
  'and its findings leave with it');

-- ── attributes: a third catalogue, category toggles default true ────────
insert into attributes (id, name, unit) values ('aaaa0000-0000-4000-8000-0000000000a1','Fixture Max Boat Length','ft');
insert into attribute_location_types (attribute_id, location_type_id)
  values ('aaaa0000-0000-4000-8000-0000000000a1','cccc0000-0000-4000-8000-000000000080');
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000f6','eeee0000-0000-4000-8000-0000000000a2','eeee1111-0000-4000-8000-000000000005','11111111-0000-4000-8000-000000000001', now());
insert into audit_proposals (finding_id, kind, payload) values
  ('ffff0000-0000-4000-8000-0000000000f6','set_attribute',
   '{"attribute_id":"aaaa0000-0000-4000-8000-0000000000a1","value":35,"note":null}');
select set_config('request.jwt.claims', '{"sub":"user_carl"}', true);
set local role authenticated;
select is(pg_temp.upd_count($u$update audit_proposals set decision = 'approved', decided_by_id = '11111111-0000-4000-8000-000000000003'
             where finding_id = 'ffff0000-0000-4000-8000-0000000000f6'$u$), 1,
  'manage_audits alone decides a set_attribute proposal — not structural');
reset role;
select close_audit('eeee0000-0000-4000-8000-0000000000a2');
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select lives_ok($$select finalize_audit('eeee0000-0000-4000-8000-0000000000a2')$$,
  'finalize_audit applies an approved set_attribute proposal');
reset role;
select is((select value from location_attributes where location_id = 'dddd0000-0000-4000-8000-000000000081'
             and attribute_id = 'aaaa0000-0000-4000-8000-0000000000a1')::int, 35,
  'the attribute value landed on the location');

-- Clearing a value (never a "present" flag) removes the row.
insert into audits (id, name, kind, status, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000000a4','Fixture Audit Four','status','open','11111111-0000-4000-8000-000000000001');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee1111-0000-4000-8000-000000000008','eeee0000-0000-4000-8000-0000000000a4','dddd0000-0000-4000-8000-000000000081','AF-S1',0);
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000f8','eeee0000-0000-4000-8000-0000000000a4','eeee1111-0000-4000-8000-000000000008','11111111-0000-4000-8000-000000000001', now());
insert into audit_proposals (finding_id, kind, payload) values
  ('ffff0000-0000-4000-8000-0000000000f8','set_attribute',
   '{"attribute_id":"aaaa0000-0000-4000-8000-0000000000a1","value":null,"note":null}');
select set_config('request.jwt.claims', '{"sub":"user_carl"}', true);
set local role authenticated;
select is(pg_temp.upd_count($u$update audit_proposals set decision = 'approved', decided_by_id = '11111111-0000-4000-8000-000000000003'
             where finding_id = 'ffff0000-0000-4000-8000-0000000000f8'$u$), 1,
  'clearing an attribute value is decided the same way as setting one');
reset role;
select close_audit('eeee0000-0000-4000-8000-0000000000a4');
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select lives_ok($$select finalize_audit('eeee0000-0000-4000-8000-0000000000a4')$$,
  'finalize_audit applies a set_attribute proposal with a null value');
reset role;
select is((select count(*) from location_attributes where location_id = 'dddd0000-0000-4000-8000-000000000081'
             and attribute_id = 'aaaa0000-0000-4000-8000-0000000000a1')::int, 0,
  'a null value deletes the row rather than leaving it at its last number');

select is((select include_services::int + include_amenities::int + include_attributes::int
            + include_marked::int + include_map::int from audit_templates where id = 'eeee0000-0000-4000-8000-000000000080'),
  5, 'a template asks about every built-in Status category by default');

-- ── a choice Attribute lands in value_text, and only one column may hold it
insert into attributes (id, name, kind, choices) values
  ('aaaa0000-0000-4000-8000-0000000000a2','Fixture Site Type','choice', array['Back-in','Pull-through']);
insert into audits (id, name, kind, status, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000000a5','Fixture Audit Five','status','open','11111111-0000-4000-8000-000000000001');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee1111-0000-4000-8000-000000000009','eeee0000-0000-4000-8000-0000000000a5','dddd0000-0000-4000-8000-000000000081','AF-S1',0);
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000f9','eeee0000-0000-4000-8000-0000000000a5','eeee1111-0000-4000-8000-000000000009','11111111-0000-4000-8000-000000000001', now());
insert into audit_proposals (finding_id, kind, decision, decided_by_id, payload) values
  ('ffff0000-0000-4000-8000-0000000000f9','set_attribute','approved','11111111-0000-4000-8000-000000000001',
   '{"attribute_id":"aaaa0000-0000-4000-8000-0000000000a2","value":null,"text":"Pull-through","note":null}');
select close_audit('eeee0000-0000-4000-8000-0000000000a5');
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select lives_ok($$select finalize_audit('eeee0000-0000-4000-8000-0000000000a5')$$,
  'finalize_audit applies a choice Attribute');
reset role;
select is((select value_text from location_attributes where location_id = 'dddd0000-0000-4000-8000-000000000081'
             and attribute_id = 'aaaa0000-0000-4000-8000-0000000000a2'), 'Pull-through',
  'a choice Attribute lands in value_text, not value');
select throws_ok(
  $$insert into location_attributes (location_id, attribute_id, value, value_text)
    values ('dddd0000-0000-4000-8000-000000000083','aaaa0000-0000-4000-8000-0000000000a2', 3, 'Back-in')$$,
  '23514', null,
  'a Location Attribute holds a number or a choice, never both');

-- ── confirmation: a location is audited when the auditor says so ────────
-- A wizard run is a slice - the power pedestals today, the fire rings on
-- Thursday - so recording an answer cannot be what says the location is
-- done. The Finding accumulates unconfirmed; confirming it is the event.
insert into locations (id, name, location_type_id) values
  ('dddd0000-0000-4000-8000-000000000085','AF-S5','cccc0000-0000-4000-8000-000000000080'),
  ('dddd0000-0000-4000-8000-000000000086','AF-S6','cccc0000-0000-4000-8000-000000000080');
insert into audits (id, name, kind, status, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000000a6','Fixture Audit Six','status','open','11111111-0000-4000-8000-000000000001');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee1111-0000-4000-8000-00000000000a','eeee0000-0000-4000-8000-0000000000a6','dddd0000-0000-4000-8000-000000000085','AF-S5',0),
  ('eeee1111-0000-4000-8000-00000000000b','eeee0000-0000-4000-8000-0000000000a6','dddd0000-0000-4000-8000-000000000086','AF-S6',1);

select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
insert into audit_findings (id, audit_id, target_id, recorded_by_id) values
  ('ffff0000-0000-4000-8000-0000000000fa','eeee0000-0000-4000-8000-0000000000a6',
   'eeee1111-0000-4000-8000-00000000000a','11111111-0000-4000-8000-000000000002');
reset role;
select is((select state::text from audit_targets where id = 'eeee1111-0000-4000-8000-00000000000a'), 'pending',
  'an unconfirmed finding leaves its location in the queue');

select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
select is(pg_temp.upd_count($u$update audit_findings set confirmed_at = now()
            where id = 'ffff0000-0000-4000-8000-0000000000fa'$u$), 1,
  'the auditor who recorded it is the one who says it is done');
reset role;
select is((select state::text from audit_targets where id = 'eeee1111-0000-4000-8000-00000000000a'), 'audited',
  'confirming is what marks the location audited');
select is((select status::text from audits where id = 'eeee0000-0000-4000-8000-0000000000a6'), 'open',
  'and the audit stays open while another location is unconfirmed');

select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
update audit_findings set confirmed_at = null where id = 'ffff0000-0000-4000-8000-0000000000fa';
reset role;
select is((select state::text from audit_targets where id = 'eeee1111-0000-4000-8000-00000000000a'), 'pending',
  'reopening a location puts it back in the queue, its answers untouched');

select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000fb','eeee0000-0000-4000-8000-0000000000a6',
   'eeee1111-0000-4000-8000-00000000000b','11111111-0000-4000-8000-000000000002', now());
update audit_findings set confirmed_at = now() where id = 'ffff0000-0000-4000-8000-0000000000fa';
reset role;
select is((select status::text from audits where id = 'eeee0000-0000-4000-8000-0000000000a6'), 'closed',
  'the audit closes when the last location is confirmed, not when its last answer lands');

-- ── reopening an audit ──────────────────────────────────────────────────
-- Closing is a convenience; being unable to undo it is not. The way back
-- restores what the close pushed out of the queue and nothing else.
insert into locations (id, name, location_type_id) values
  ('dddd0000-0000-4000-8000-000000000087','AF-S7','cccc0000-0000-4000-8000-000000000080'),
  ('dddd0000-0000-4000-8000-000000000088','AF-S8','cccc0000-0000-4000-8000-000000000080'),
  ('dddd0000-0000-4000-8000-000000000089','AF-S9','cccc0000-0000-4000-8000-000000000080');
insert into audits (id, name, kind, status, launched_by_id) values
  ('eeee0000-0000-4000-8000-0000000000a7','Fixture Audit Seven','status','open','11111111-0000-4000-8000-000000000001');
insert into audit_targets (id, audit_id, location_id, location_name, position) values
  ('eeee1111-0000-4000-8000-00000000000c','eeee0000-0000-4000-8000-0000000000a7','dddd0000-0000-4000-8000-000000000087','AF-S7',0),
  ('eeee1111-0000-4000-8000-00000000000d','eeee0000-0000-4000-8000-0000000000a7','dddd0000-0000-4000-8000-000000000088','AF-S8',1),
  ('eeee1111-0000-4000-8000-00000000000e','eeee0000-0000-4000-8000-0000000000a7','dddd0000-0000-4000-8000-000000000089','AF-S9',2);
-- S7 was audited and signed off; S9 was skipped for its own reason; S8 was
-- simply never reached before the shift ended.
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000fc','eeee0000-0000-4000-8000-0000000000a7',
   'eeee1111-0000-4000-8000-00000000000c','11111111-0000-4000-8000-000000000002', now());
update audit_targets set state = 'not_audited', not_audited_reason = 'gate locked'
 where id = 'eeee1111-0000-4000-8000-00000000000e';
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
select close_audit('eeee0000-0000-4000-8000-0000000000a7');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
select throws_ok($$select reopen_audit('eeee0000-0000-4000-8000-0000000000a7')$$, '42501', null,
  'reopening an audit takes manage_audits');
reset role;
select set_config('request.jwt.claims', '{"sub":"user_carl"}', true);
set local role authenticated;
select lives_ok($$select reopen_audit('eeee0000-0000-4000-8000-0000000000a7')$$,
  'manage_audits alone reopens it - the same key that closed it');
reset role;
select is((select status::text from audits where id = 'eeee0000-0000-4000-8000-0000000000a7'), 'open',
  'the audit is open again, with no closed_at');
select is((select state::text from audit_targets where id = 'eeee1111-0000-4000-8000-00000000000d'), 'pending',
  'a location the close pushed out is back in the queue');
select is((select state::text || '/' || not_audited_reason from audit_targets where id = 'eeee1111-0000-4000-8000-00000000000e'),
  'not_audited/gate locked',
  'one marked Not Audited for its own reason is left as it was');

-- The trap: every target confirmed means nothing is pending, and the
-- auto-close would shut an audit somebody had just deliberately reopened.
select set_config('request.jwt.claims', '{"sub":"user_bob"}', true);
set local role authenticated;
insert into audit_findings (id, audit_id, target_id, recorded_by_id, confirmed_at) values
  ('ffff0000-0000-4000-8000-0000000000fd','eeee0000-0000-4000-8000-0000000000a7',
   'eeee1111-0000-4000-8000-00000000000d','11111111-0000-4000-8000-000000000002', now());
reset role;
select is((select status::text from audits where id = 'eeee0000-0000-4000-8000-0000000000a7'), 'open',
  'a reopened audit does not close itself again - a person closes it');

select set_config('request.jwt.claims', '{"sub":"user_carl"}', true);
set local role authenticated;
select throws_ok($$select reopen_audit('eeee0000-0000-4000-8000-0000000000a1')$$, '23514', null,
  'a finalized audit is not reopened - its proposals have been applied');
reset role;

select * from finish();
rollback;
