-- Table privileges.
--
-- Without these, RLS is never consulted: PostgREST's role is refused at the
-- privilege layer first, every query fails, and the app is uniformly broken in
-- a way that reads as "the database is down". A policy set that denies
-- everyone passes every anonymous-access test, which is why this file exists
-- and why the pgTAP suite asserts positive access as well as denial.
--
-- Privileges say WHICH VERBS are possible; RLS says WHICH ROWS. Both matter.

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- anon gets nothing. Every policy already requires an active marina user, so
-- this is belt and braces — but it means an unauthenticated request fails at
-- the privilege layer rather than relying on a policy being correct.
revoke all on all tables in schema public from anon;

-- Where the model says "never", revoke the verb as well as omitting the
-- policy. Two independent mechanisms have to fail for these to happen.
--
--   activity_log_entries : immutable audit record; only pg_cron purges it.
--   users                : deactivated, never deleted, so history survives.
--   incidents            : never deleted from a client.
revoke delete on public.activity_log_entries from authenticated;
revoke delete on public.users                from authenticated;
revoke delete on public.incidents            from authenticated;

-- The effective_permissions view is SECURITY DEFINER by construction (a view
-- reads its owner's privileges), so granting it to authenticated would let any
-- staff member read EVERY user's effective permissions, bypassing the RLS on
-- roles and user_roles underneath. Nothing needs direct access: has_permission()
-- is security definer and answers the only question callers actually ask.
revoke all on public.effective_permissions from authenticated, anon;
