-- Narrow the auth helpers to the role that actually needs them.
--
-- Supabase's remote security advisor flags SECURITY DEFINER functions callable
-- by anon or authenticated. Three of those flags were real surface and three
-- are structural; this migration removes the real ones and records why the
-- rest stay.
--
-- REMOVED — anon never needs these. It holds no table privileges at all
-- (20260826001900_grants.sql revokes them), so no RLS policy is ever evaluated
-- on its behalf and nothing calls these functions in an anonymous request.
revoke execute on function public.current_marina_user_id() from anon;
revoke execute on function public.is_active_marina_user()  from anon;
revoke execute on function public.has_permission(text)     from anon;

-- KEPT, deliberately — authenticated must retain EXECUTE.
--
-- An RLS policy expression is evaluated with the CALLING role's privileges. If
-- authenticated cannot execute has_permission(), every policy that calls it
-- fails, and the database becomes uniformly unreadable — the same
-- denies-everyone failure the missing table grants already caused once.
--
-- The exposure is bounded by what the functions return: each answers a
-- question about the CALLER (who am I, may I do X) and takes no argument that
-- could redirect it at somebody else. has_permission('x') cannot be asked on
-- another user's behalf, because the subject is always
-- current_marina_user_id(). This warning is inherent to any RLS design built
-- on helper functions, and is accepted rather than worked around.
