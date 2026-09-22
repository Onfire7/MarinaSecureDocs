-- Activity Log retention.
--
-- This is the one place the migration DELETES planned infrastructure rather
-- than adding it. docs/api-structure.md previously specified a Netlify
-- Scheduled Function for this, because InstantDB had no server-side scheduler.
-- Supabase has pg_cron, so it becomes a scheduled statement — one fewer
-- deployed artifact per marina. It remains work no client may do: there is no
-- delete policy on activity_log_entries at all.

create function public.purge_activity_log() returns integer
  language plpgsql security definer set search_path = public
as $$
declare
  keep_days integer;
  removed   integer;
begin
  select activity_log_retention_days into keep_days from public.marina_settings where id = 1;
  if keep_days is null then
    return 0;   -- unconfigured marina: purge nothing rather than everything
  end if;

  delete from public.activity_log_entries
   where not protected
     and timestamp < now() - make_interval(days => keep_days);

  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function public.purge_activity_log() from public, anon, authenticated;

-- Scheduled only where pg_cron is actually installed, so the migration is safe
-- to run against a local stack or a project without it.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-activity-log')
      where exists (select 1 from cron.job where jobname = 'purge-activity-log');
    perform cron.schedule('purge-activity-log', '17 3 * * *',
                          'select public.purge_activity_log()');
  end if;
end $$;
