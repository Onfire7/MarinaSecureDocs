-- Identity resolution and the permission model, in SQL.
--
-- The JWT carries only the subject. Roles and permissions are NOT claims:
-- PowerSync parameter queries can look up from the database directly, and
-- getting permissions into a Clerk token would require writing
-- user.public_metadata through Clerk's Backend API — a server-side credential
-- this architecture does not have. Resolving here means RLS and sync-stream
-- scoping read the same tables, so there is one authorization model rather
-- than two that can disagree. See docs/permissions.md.

-- Read the verified claims. Deliberately reads the GUC rather than auth.jwt()
-- so pgTAP can set it directly with `set local`, and so nothing here depends
-- on the auth schema.
create function public.jwt_claims() returns jsonb
  language sql stable set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- The acting marina user, or NULL.
--
-- NULL for an outsider Clerk identity, and NULL for a DEACTIVATED one — which
-- is what makes `active = false` a complete revocation rather than a UI
-- change. Every policy below fails closed on NULL.
create function public.current_marina_user_id() returns uuid
  language sql stable security definer set search_path = public
as $$
  select u.id
    from public.users u
   where u.clerk_user_id = public.jwt_claims() ->> 'sub'
     and u.active
   limit 1
$$;

create function public.is_active_marina_user() returns boolean
  language sql stable security definer set search_path = public
as $$
  select public.current_marina_user_id() is not null
$$;

-- The trinary model: default Deny, any Allow grants, any explicit Deny cancels
-- every Allow. EXCEPT *is* deny-wins, and it is order-independent — a user's
-- permissions cannot depend on the order their roles were assigned.
--
-- This must agree case-for-case with computeEffectivePermissions in
-- src/lib/permissions.ts. If the two disagree, the interface and the database
-- disagree about who can do what.
create view public.effective_permissions as
      select ur.user_id, p.permission
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        cross join lateral unnest(r.allow) as p(permission)
  except
      select ur.user_id, p.permission
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        cross join lateral unnest(r.deny) as p(permission);

create function public.has_permission(perm text) returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.effective_permissions ep
     where ep.user_id = public.current_marina_user_id()
       and ep.permission = perm
  )
$$;

revoke all on function public.jwt_claims()             from public, anon, authenticated;
revoke all on function public.current_marina_user_id() from public, anon, authenticated;
grant execute on function public.current_marina_user_id() to anon, authenticated;
grant execute on function public.is_active_marina_user()  to anon, authenticated;
grant execute on function public.has_permission(text)     to anon, authenticated;
