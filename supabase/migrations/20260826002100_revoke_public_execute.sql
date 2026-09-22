-- Revoking from `anon` alone did nothing, and the reason is worth writing down.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and `anon`
-- inherits through PUBLIC. So `revoke execute ... from anon` removes a grant
-- that was never the one doing the work — the function stays callable, and the
-- advisor keeps flagging it. The default has to be revoked from PUBLIC itself,
-- and privileges then granted back explicitly to the one role that needs them.
--
-- The same shape as the missing table grants earlier in this migration set: a
-- privilege problem that is invisible until something asserts the negative.
revoke execute on function public.is_active_marina_user() from public;
revoke execute on function public.has_permission(text)    from public;
revoke execute on function public.purge_activity_log()    from public;

-- authenticated keeps EXECUTE: an RLS policy expression is evaluated with the
-- calling role's privileges, so without this every policy fails closed and the
-- database becomes uniformly unreadable.
grant execute on function public.is_active_marina_user() to authenticated;
grant execute on function public.has_permission(text)    to authenticated;
