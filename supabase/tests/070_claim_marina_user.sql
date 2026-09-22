-- claim_marina_user() — the one function that can create an identity.
--
-- It runs SECURITY DEFINER with no arguments, on behalf of a caller who has no
-- identity yet, and its whole safety argument rests on which JWT claims it
-- insists on. Each test below removes one of those conditions and asserts that
-- the claim fails. A regression here is not a bug, it is account takeover.
create extension if not exists pgtap;
begin;
select plan(8);

insert into users (id, name, email, clerk_user_id, active) values
  ('bbbb0000-0000-4000-8000-000000000001', 'Provisioned Never Signed In',
   'newhire@example.test', null, true),
  ('bbbb0000-0000-4000-8000-000000000002', 'Already Signed In',
   'veteran@example.test', 'user_veteran', true),
  ('bbbb0000-0000-4000-8000-000000000003', 'Deactivated',
   'former@example.test', null, false),
  ('bbbb0000-0000-4000-8000-000000000004', 'Mixed Case Address',
   'Dockmaster@Example.Test', null, true);

-- 1. The happy path: a verified email matches a provisioned row.
select set_config('request.jwt.claims',
  '{"sub":"user_newhire","email":"newhire@example.test","email_verified":true}', true);
select is(claim_marina_user(), 'bbbb0000-0000-4000-8000-000000000001'::uuid,
  'a verified email claims its provisioned user row');

-- 2. And the row now resolves through the join every policy uses. Claiming
--    without this would succeed and still leave the account with no access.
select is(current_marina_user_id(), 'bbbb0000-0000-4000-8000-000000000001'::uuid,
  'the claimed row is what current_marina_user_id() now resolves to');

-- 3. Idempotent. The client calls this whenever it cannot find itself, which
--    includes "has not finished syncing yet", so it runs more than once.
select is(claim_marina_user(), 'bbbb0000-0000-4000-8000-000000000001'::uuid,
  'claiming again returns the same row rather than failing');

-- 4. An unverified address proves nothing. Clerk lets an account carry an
--    email it has not confirmed; treating that as ownership would let anyone
--    who types a staff address into their own Clerk account take that row.
select set_config('request.jwt.claims',
  '{"sub":"user_impostor","email":"Dockmaster@Example.Test","email_verified":false}', true);
select is(claim_marina_user(), null,
  'an UNVERIFIED email claims nothing');

-- 5. Absent the claim entirely — same answer, failing closed.
select set_config('request.jwt.claims',
  '{"sub":"user_impostor","email":"Dockmaster@Example.Test"}', true);
select is(claim_marina_user(), null,
  'a token with no email_verified claim claims nothing');

-- 6. An already-claimed row is never reassigned. This is the difference
--    between a function that can create an identity and one that can move
--    one; only the first is a sign-in step.
select set_config('request.jwt.claims',
  '{"sub":"user_thief","email":"veteran@example.test","email_verified":true}', true);
select is(claim_marina_user(), null,
  'a row already bound to another Clerk identity cannot be re-claimed');

-- 7. Deactivation is not undone by signing in.
select set_config('request.jwt.claims',
  '{"sub":"user_former","email":"former@example.test","email_verified":true}', true);
select is(claim_marina_user(), null,
  'a deactivated row cannot be claimed');

-- 8. Email case is not identity. Clerk normalises to lower case and an admin
--    typing an address into Admin → Users does not; matching exactly would
--    strand that person on a screen saying their account does not exist.
select set_config('request.jwt.claims',
  '{"sub":"user_dockmaster","email":"dockmaster@example.test","email_verified":true}', true);
select is(claim_marina_user(), 'bbbb0000-0000-4000-8000-000000000004'::uuid,
  'the email match is case-insensitive');

select * from finish();
rollback;
