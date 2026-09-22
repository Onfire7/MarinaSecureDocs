-- PowerSync's replication publication.
--
-- The ROLE is deliberately not created here: it needs a password, and a
-- password in a migration is a password in git. scripts/provision-supabase.sh
-- generates one per marina and prints the SQL. The publication carries no
-- secret, so it belongs in version control where a new marina picks it up
-- automatically.
--
-- PowerSync must read every update in the publication regardless of whether a
-- table appears in a sync stream, which is why it is FOR ALL TABLES.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    create publication powersync for all tables;
  end if;
end $$;
