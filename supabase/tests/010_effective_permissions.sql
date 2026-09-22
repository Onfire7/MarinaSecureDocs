-- The trinary permission model, in SQL.
--
-- These mirror src/lib/permissions.test.ts case for case. That is the point:
-- the view is about to become the authority the UI's computation must agree
-- with, and if the two ever diverge the interface and the database disagree
-- about who can do what — which is the failure RLS exists to prevent.
create extension if not exists pgtap;
begin;
select plan(7);

insert into users (id, name, clerk_user_id, active) values
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'user_alice', true);

insert into roles (id, name, allow, deny) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Security',
     array['create_incidents','assign_ticket_to_others','view_incidents'], array[]::text[]),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Trainee',
     array[]::text[], array['assign_ticket_to_others']),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Silent',
     array[]::text[], array[]::text[]),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Legacy',
     array['not_a_real_permission','view_reports'], array[]::text[]);

create function perms_of(uuid) returns setof text language sql as $$
  select permission from effective_permissions where user_id = $1 order by 1
$$;

-- 1. Any role's Allow grants.
insert into user_roles values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001');
select ok(
  'create_incidents' in (select perms_of('11111111-1111-1111-1111-111111111111')),
  'an Allow from any held role grants the permission');

-- 2. An explicit Deny cancels another role's Allow.
insert into user_roles values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002');
select ok(
  'assign_ticket_to_others' not in (select perms_of('11111111-1111-1111-1111-111111111111')),
  'an explicit Deny cancels an Allow held through another role');

-- 3. Deny is unconditional, not last-write-wins. A user's permissions must not
--    depend on the order their roles happened to be assigned.
delete from user_roles where user_id = '11111111-1111-1111-1111-111111111111';
insert into user_roles values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002');
insert into user_roles values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001');
select ok(
  'assign_ticket_to_others' not in (select perms_of('11111111-1111-1111-1111-111111111111')),
  'Deny wins regardless of the order roles were assigned');

-- 4. Undefined is no opinion, not a Deny.
insert into user_roles values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000003');
select ok(
  'view_incidents' in (select perms_of('11111111-1111-1111-1111-111111111111')),
  'a role with no opinion does not cancel another role''s Allow');

-- 5. Default is Deny.
select ok(
  'manage_marina_settings' not in (select perms_of('11111111-1111-1111-1111-111111111111')),
  'a permission no role mentions is not granted');

-- 6. Unknown keys are inert. Roles are admin-edited data; a stale or
--    hand-written key must not break the view or leak in as a permission.
insert into user_roles values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000004');
select ok(
  'view_reports' in (select perms_of('11111111-1111-1111-1111-111111111111')),
  'a junk key alongside a real one does not break the view');

-- 7. A user with no roles resolves to the empty set, not an error.
insert into users (id, name, clerk_user_id, active)
  values ('22222222-2222-2222-2222-222222222222', 'Bob', 'user_bob', true);
select is(
  (select count(*) from perms_of('22222222-2222-2222-2222-222222222222'))::int, 0,
  'a user holding no roles has no permissions, and does not error');

select * from finish();
rollback;
