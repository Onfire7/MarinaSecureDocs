-- Local development seed. Runs on `supabase db reset`; never pushed to a
-- remote project (`db push` reports "seeds":[]).
--
-- Creates the replication role the local PowerSync container connects as. On a
-- real marina this role is created by scripts/provision-supabase.sh with a
-- generated password, which is why it is not in a migration — a password in a
-- migration is a password in git. The credentials below are local-only and
-- reach nothing: the database they unlock is a disposable container on
-- 127.0.0.1.
--
-- The `powersync` publication itself IS a migration (20260826001800), because
-- it carries no secret.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'powersync_role') then
    create role powersync_role with replication bypassrls login password 'powersync_local_dev';
  end if;
end $$;

grant select on all tables in schema public to powersync_role;
alter default privileges in schema public grant select on tables to powersync_role;
