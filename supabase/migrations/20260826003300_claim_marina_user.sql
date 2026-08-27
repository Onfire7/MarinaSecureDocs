-- First sign-in: binding a provisioned user row to the Clerk identity that
-- just proved it owns the email address.
--
-- Users are provisioned in Admin → Users by email, before that person has ever
-- signed in, so users.clerk_user_id starts null. Every policy in this database
-- resolves identity through current_marina_user_id(), which joins on that
-- column — so until it is set, the account has no identity here at all, and
-- the write that would set it is itself denied. The user cannot claim their
-- own row, because claiming it is what would give them the right to.
--
-- InstantDB had the same problem and solved it in the client: the app matched
-- on email and wrote clerk_user_id itself. That worked only because Instant's
-- rules let it. Here it would mean granting every anonymous caller UPDATE on
-- users, which is an account-takeover primitive, not a sign-in step.
--
-- So the claim happens in the database, where it can be conditioned on things
-- a client cannot forge:
--
--   * The email comes from the verified JWT, never from an argument. Clerk's
--     session token carries `email` and `email_verified` (confirmed against a
--     real minted token), and this function reads only those. There is no
--     parameter to tamper with — the entire input is the signature-checked
--     token.
--   * email_verified must be true. Clerk allows an unverified address on an
--     account; treating one as proof of ownership would let anyone who typed
--     a staff member's address into their own Clerk account take that row.
--   * clerk_user_id must still be null. An already-claimed row is never
--     reassigned, so this can create an identity but can never move one.
--   * The row must be active. A deactivated account does not come back by
--     signing in.
--
-- SECURITY DEFINER is load-bearing rather than convenient: the caller has no
-- identity yet, so the function must run as one that does.
create function public.claim_marina_user() returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  claims jsonb := public.jwt_claims();
  sub    text;
  mail   text;
  found  uuid;
begin
  sub := claims ->> 'sub';
  if sub is null then
    return null;
  end if;

  -- Idempotent. The client calls this whenever it cannot find itself, which
  -- includes the case where it simply has not synced yet.
  select u.id into found from users u where u.clerk_user_id = sub and u.active;
  if found is not null then
    return found;
  end if;

  mail := lower(claims ->> 'email');
  if mail is null or coalesce((claims ->> 'email_verified')::boolean, false) is not true then
    return null;
  end if;

  update users u
     set clerk_user_id = sub
   where lower(u.email) = mail
     and u.clerk_user_id is null
     and u.active
  returning u.id into found;

  -- The update fires users_refresh_permissions, which is what puts this
  -- person's clerk_user_id onto their user_permissions rows. Without that the
  -- claim would succeed and every permission-gated stream would still deliver
  -- nothing, because those streams key on exactly that column.
  return found;
end $$;

comment on function public.claim_marina_user() is
  'Binds a provisioned users row to the calling Clerk identity, on verified email. Returns the marina user id, or null if there is nothing to claim.';

revoke all on function public.claim_marina_user() from public, anon;
grant execute on function public.claim_marina_user() to authenticated;
