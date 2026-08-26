-- Denormalise clerk_user_id onto user_permissions, so a sync rule can key on it.
--
-- A sync data query can only constrain anything when its inner filter compares
-- to a REQUEST parameter — that is what compiles to a lookup index. The gate we
-- need is "does the requesting user hold this permission", and the only handle
-- a stream has on the requester is auth.user_id(), which is Clerk's subject.
--
-- Reaching users.clerk_user_id from user_permissions would need a nested
-- subquery. Carrying the subject on the row makes the filter one hop:
--
--   'view_incidents' IN (SELECT permission FROM user_permissions
--                         WHERE clerk_user_id = auth.user_id())
--
-- The column is a cache of users.clerk_user_id, maintained by the same
-- differential refresh, and the table is already a cache — so this adds no new
-- class of staleness.
alter table user_permissions add column clerk_user_id text;
create index user_permissions_clerk_idx on user_permissions (clerk_user_id, permission);

create or replace function public.refresh_user_permissions() returns void
  language plpgsql security definer set search_path = public
as $$
begin
  delete from user_permissions up
   where not exists (select 1 from effective_permissions ep
                      where ep.user_id = up.user_id and ep.permission = up.permission);

  insert into user_permissions (user_id, permission, clerk_user_id)
  select ep.user_id, ep.permission, u.clerk_user_id
    from effective_permissions ep join users u on u.id = ep.user_id
  on conflict (user_id, permission) do update
     set clerk_user_id = excluded.clerk_user_id
   where user_permissions.clerk_user_id is distinct from excluded.clerk_user_id;
end $$;

-- A user claiming their Clerk identity on first sign-in changes clerk_user_id,
-- which has to reach the cache or that user syncs nothing permission-gated.
create function public.trg_users_refresh_permissions() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  perform public.refresh_user_permissions();
  return null;
end $$;
revoke execute on function public.trg_users_refresh_permissions() from anon, authenticated, public;

create trigger users_refresh_permissions
  after insert or update of clerk_user_id, active or delete on users
  for each statement execute function public.trg_users_refresh_permissions();

select public.refresh_user_permissions();
