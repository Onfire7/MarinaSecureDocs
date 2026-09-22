-- Sync scoping, as columns rather than predicates.
--
-- docs/architecture.md defines occupancy and age scoping in terms of "now":
-- contacts attached to a current lease plus a 30-day trailing window, check-ins
-- from a recent window. Neither is expressible in a sync rule. PowerSync
-- pre-computes bucket assignments, so range operators and now() are both
-- unsupported — a rule must be deterministic, and "recent" is not.
--
-- The documented answer is to move the time comparison out of the rule and into
-- the data: a boolean column, refreshed on a schedule. pg_cron already runs the
-- retention purge, so this costs one more job rather than new infrastructure.
--
-- The cost is staleness: a flag is at most one refresh out of date. For a
-- 30-day window that is immaterial, and the refresh is cheap enough to run
-- hourly if it ever stops being.

alter table leases               add column is_current  boolean not null default false;
alter table reservations         add column is_current  boolean not null default false;
alter table contacts             add column is_resident boolean not null default false;
alter table boats                add column is_resident boolean not null default false;
alter table vehicles             add column is_resident boolean not null default false;

alter table check_ins            add column is_recent boolean not null default true;
alter table activity_log_entries add column is_recent boolean not null default true;
alter table incidents            add column is_recent boolean not null default true;
alter table tickets              add column is_recent boolean not null default true;
alter table notes                add column is_recent boolean not null default true;
alter table checklist_instances  add column is_recent boolean not null default true;
alter table shifts               add column is_recent boolean not null default true;
alter table calls                add column is_recent boolean not null default true;
alter table sms_threads          add column is_recent boolean not null default true;
alter table chat_rooms           add column is_recent boolean not null default true;

-- Partial indexes: every sync stream filters on these being true, and the
-- true set is the small one.
create index leases_current_idx        on leases (id)               where is_current;
create index reservations_current_idx  on reservations (id)         where is_current;
create index contacts_resident_idx     on contacts (id)             where is_resident;
create index check_ins_recent_idx      on check_ins (id)            where is_recent;
create index activity_log_recent_idx   on activity_log_entries (id) where is_recent;

-- New rows default to visible (is_recent = true) so a check-in written on a
-- dock reaches other devices immediately rather than waiting for the next
-- refresh. Occupancy flags default false because residency is derived from a
-- lease or reservation that the application writes separately, and guessing
-- "resident" would leak a contact before anything justified it.

create function public.refresh_sync_scopes() returns void
  language plpgsql security definer set search_path = public
as $$
declare
  -- Windows live here rather than being scattered through the function, so
  -- changing "recent" is one edit and the sync rules never mention a duration.
  occupancy_trail constant interval := '30 days';
  occupancy_ahead constant interval := '30 days';
  rounds_window   constant interval := '7 days';
  work_window     constant interval := '90 days';
  log_window      constant interval := '30 days';
  admin_window    constant interval := '30 days';
begin
  -- Every update is guarded by `is distinct from`. Without it each refresh
  -- rewrites every row, and a rewrite is a replication event — an unguarded
  -- nightly job would push the entire database through the sync pipe once a
  -- day and wake every device up to re-download it.

  update leases set is_current = v.want
    from (select id,
                 (start_date is null or start_date <= now())
             and (end_date   is null or end_date   >= now() - occupancy_trail) as want
            from leases) v
   where leases.id = v.id and leases.is_current is distinct from v.want;

  -- Reservations look forward as well as back: a guard starting a shift needs
  -- tomorrow's arrivals, not only yesterday's departures.
  update reservations set is_current = v.want
    from (select id,
                 expected_checkout >= now() - occupancy_trail
             and expected_checkin  <= now() + occupancy_ahead as want
            from reservations) v
   where reservations.id = v.id and reservations.is_current is distinct from v.want;

  update contacts set is_resident = v.want
    from (select c.id,
                 exists (select 1 from lease_lessees ll join leases l on l.id = ll.lease_id
                          where ll.contact_id = c.id and l.is_current)
              or exists (select 1 from reservations r
                          where r.contact_id = c.id and r.is_current) as want
            from contacts c) v
   where contacts.id = v.id and contacts.is_resident is distinct from v.want;

  -- A boat is resident if it sits in a slip under a current lease, or if one
  -- of its owners is. The first covers a boat whose owner is off-season.
  update boats set is_resident = v.want
    from (select b.id,
                 exists (select 1 from locations loc join leases l on l.location_id = loc.id
                          where loc.current_boat_id = b.id and l.is_current)
              or exists (select 1 from boat_owners bo join contacts c on c.id = bo.contact_id
                          where bo.boat_id = b.id and c.is_resident) as want
            from boats b) v
   where boats.id = v.id and boats.is_resident is distinct from v.want;

  update vehicles set is_resident = v.want
    from (select ve.id,
                 exists (select 1 from vehicle_owners vo join contacts c on c.id = vo.contact_id
                          where vo.vehicle_id = ve.id and c.is_resident) as want
            from vehicles ve) v
   where vehicles.id = v.id and vehicles.is_resident is distinct from v.want;

  -- Age-scoped. Work items stay resident while they are OPEN however old they
  -- are: an incident from last year that nobody closed is exactly the thing a
  -- guard needs on a dock, and dropping it because of its age would be the
  -- same defect this migration exists to fix.
  update check_ins set is_recent = v.want
    from (select id, timestamp >= now() - rounds_window as want from check_ins) v
   where check_ins.id = v.id and check_ins.is_recent is distinct from v.want;

  update activity_log_entries set is_recent = v.want
    from (select id, timestamp >= now() - log_window as want from activity_log_entries) v
   where activity_log_entries.id = v.id and activity_log_entries.is_recent is distinct from v.want;

  update incidents set is_recent = v.want
    from (select i.id,
                 i.created_at >= now() - work_window
              or not coalesce((select s.is_terminal from incident_statuses s where s.id = i.status_id), false) as want
            from incidents i) v
   where incidents.id = v.id and incidents.is_recent is distinct from v.want;

  update tickets set is_recent = v.want
    from (select t.id,
                 t.created_at >= now() - work_window
              or not coalesce((select s.is_terminal from ticket_statuses s where s.id = t.status_id), false) as want
            from tickets t) v
   where tickets.id = v.id and tickets.is_recent is distinct from v.want;

  update notes set is_recent = v.want
    from (select id, created_at >= now() - work_window as want from notes) v
   where notes.id = v.id and notes.is_recent is distinct from v.want;

  update checklist_instances set is_recent = v.want
    from (select id, (status <> 'complete')
                  or coalesce(completed_at, started_at) >= now() - admin_window as want
            from checklist_instances) v
   where checklist_instances.id = v.id and checklist_instances.is_recent is distinct from v.want;

  update shifts set is_recent = v.want
    from (select id, ended_at is null or ended_at >= now() - admin_window as want from shifts) v
   where shifts.id = v.id and shifts.is_recent is distinct from v.want;

  update calls set is_recent = v.want
    from (select id, started_at is null or started_at >= now() - admin_window as want from calls) v
   where calls.id = v.id and calls.is_recent is distinct from v.want;

  update sms_threads set is_recent = v.want
    from (select id, last_message_at is null or last_message_at >= now() - admin_window as want
            from sms_threads) v
   where sms_threads.id = v.id and sms_threads.is_recent is distinct from v.want;

  update chat_rooms set is_recent = v.want
    from (select id, created_at >= now() - admin_window as want from chat_rooms) v
   where chat_rooms.id = v.id and chat_rooms.is_recent is distinct from v.want;
end $$;

revoke all on function public.refresh_sync_scopes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('refresh-sync-scopes')
      where exists (select 1 from cron.job where jobname = 'refresh-sync-scopes');
    -- Hourly, not nightly: the forward-looking reservation window means a
    -- booking made this morning should reach the dock today.
    perform cron.schedule('refresh-sync-scopes', '7 * * * *',
                          'select public.refresh_sync_scopes()');
  end if;
end $$;
