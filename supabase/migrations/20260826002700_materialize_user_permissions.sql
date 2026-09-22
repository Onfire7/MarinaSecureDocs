-- effective_permissions, as a table a sync rule can actually read.
--
-- Sync rules query PowerSync's replicated copy of the database, and only
-- TABLES are replicated — a view is not in the publication. effective_
-- permissions is a view, so a permission-scoped stream cannot subquery it,
-- which matters because sync scoping is what keeps a Tier 1 row off a device
-- in the first place. RLS is the backstop for direct API reads; it does not
-- filter replication, since powersync_role holds BYPASSRLS by necessity.
--
-- So the view is materialised into a table. The view remains the DEFINITION —
-- allow minus deny, EXCEPT is deny-wins — and this table is a cache of it,
-- refreshed whenever a role's grants or a user's role links change.

create table user_permissions (
  user_id    uuid not null references users(id) on delete cascade,
  permission text not null,
  primary key (user_id, permission)
);

alter table user_permissions enable row level security;

-- Tier 0. Migration 20260826001600 enabled RLS by looping over the tables that
-- existed then, so a table added afterwards has none — exactly the gap that
-- migration's own comment warns about. Named here rather than relying on it.
create policy tier0_select on user_permissions for select using (public.is_active_marina_user());
-- No write policies: this is a cache, maintained by triggers alone.

grant select on user_permissions to authenticated;

-- powersync_role is created OUT OF BAND — by supabase/seed.sql locally and by
-- scripts/provision-supabase.sh on a real marina — because it needs a password
-- and a password in a migration is a password in git. It therefore may not
-- exist when this runs, so the grant is conditional. Where it does not fire,
-- the `grant select on all tables` in those same out-of-band scripts covers it.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powersync_role') then
    grant select on public.user_permissions to powersync_role;
  end if;
end $$;

create function public.refresh_user_permissions() returns void
  language plpgsql security definer set search_path = public
as $$
begin
  -- Differential, not truncate-and-rebuild: every write here is a replication
  -- event, and rewriting the whole cache on any role edit would push every
  -- user's permissions to every device for no reason.
  delete from user_permissions up
   where not exists (select 1 from effective_permissions ep
                      where ep.user_id = up.user_id and ep.permission = up.permission);

  insert into user_permissions (user_id, permission)
  select ep.user_id, ep.permission from effective_permissions ep
  on conflict do nothing;
end $$;

revoke all on function public.refresh_user_permissions() from public, anon, authenticated;

create function public.trg_refresh_user_permissions() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  perform public.refresh_user_permissions();
  return null;
end $$;

-- Statement-level: a role edit touches a handful of rows and the recompute is
-- a whole-table diff either way, so per-row firing would just repeat it.
create trigger user_roles_refresh_permissions
  after insert or update or delete on user_roles
  for each statement execute function public.trg_refresh_user_permissions();

create trigger roles_refresh_permissions
  after insert or update or delete on roles
  for each statement execute function public.trg_refresh_user_permissions();

-- has_permission() reads the cache rather than recomputing the view on every
-- policy evaluation. Same answer, one index lookup.
create or replace function public.has_permission(perm text) returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_permissions up
     where up.user_id = public.current_marina_user_id()
       and up.permission = perm
  )
$$;

select public.refresh_user_permissions();
