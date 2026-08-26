-- current_marina_user_id() — the single resolution every policy starts from.
create extension if not exists pgtap;
begin;
select plan(4);

insert into users (id, name, clerk_user_id, active) values
  ('11111111-1111-1111-1111-111111111111', 'Alice',    'user_alice',    true),
  ('33333333-3333-3333-3333-333333333333', 'Deactivated', 'user_gone', false);

-- 1. Resolves a Clerk subject to the marina user.
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
select is(current_marina_user_id(), '11111111-1111-1111-1111-111111111111'::uuid,
  'a Clerk subject resolves to its marina user');

-- 2. A deactivated user resolves to NULL. This is what makes active=false a
--    complete revocation rather than a cosmetic UI change: every policy fails
--    closed on NULL, so the account loses access to every table at once.
select set_config('request.jwt.claims', '{"sub":"user_gone"}', true);
select is(current_marina_user_id(), null,
  'a deactivated user resolves to NULL, revoking access everywhere');

-- 3. An outsider Clerk identity — a real, verified account with no marina
--    User row — gets nothing.
select set_config('request.jwt.claims', '{"sub":"user_outsider"}', true);
select is(current_marina_user_id(), null,
  'a Clerk identity with no marina User resolves to NULL');

-- 4. No JWT at all fails closed.
select set_config('request.jwt.claims', '', true);
select is(current_marina_user_id(), null,
  'an anonymous request resolves to NULL');

select * from finish();
rollback;
