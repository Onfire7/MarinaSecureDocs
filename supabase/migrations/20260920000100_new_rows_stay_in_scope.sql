-- A row someone just created must stay on the phone that created it.
--
-- Occupancy scoping (20260826002600) asks whether a row is attached to a
-- current lease or reservation. For something created a moment ago the answer
-- is usually "not yet": a contact is typed in before the lease that will make
-- them a lessee, a boat before its owner, a lease for next season months
-- before its start date. The flags defaulted to FALSE and the hourly refresh
-- agreed with the default, so the sequence on a device was: create the row,
-- watch it upload, watch PowerSync remove it — because the server's copy was
-- out of scope — and never see it again. Not for an hour; for good, unless
-- something else later pulled it into scope. In a marina whose occupancy
-- tables are empty, that is every owner and every boat anyone enters.
--
-- Two changes. The flags default to TRUE, as every is_recent flag already
-- does, so a row is in scope from the instant it lands. And the refresh keeps
-- a row in scope for 30 days on the strength of being new, which is what
-- stops the first change from merely postponing the disappearance to the top
-- of the hour. After that it must earn its place the usual way.
--
-- The grace needs a creation time, which only contacts had. It is added
-- NULLABLE, with the default set afterwards, on purpose: existing rows get
-- NULL — "unknown", which is the truth — rather than a fabricated now() that
-- would declare the whole table new for a month. NULL fails the comparison,
-- so old rows are scoped exactly as before.
--
-- Children (contact_details, boat_owners, lease_lessees, …) copy their
-- parent's flag in refresh_child_sync_scopes() and need no rule of their own;
-- they only need the same TRUE default for the hour before it first runs.

alter table boats        add column created_at timestamptz;
alter table vehicles     add column created_at timestamptz;
alter table leases       add column created_at timestamptz;
alter table reservations add column created_at timestamptz;
alter table boats        alter column created_at set default now();
alter table vehicles     alter column created_at set default now();
alter table leases       alter column created_at set default now();
alter table reservations alter column created_at set default now();

alter table contacts              alter column is_resident set default true;
alter table contact_details       alter column is_resident set default true;
alter table boats                 alter column is_resident set default true;
alter table vehicles              alter column is_resident set default true;
alter table boat_owners           alter column is_resident set default true;
alter table boat_authorized_users alter column is_resident set default true;
alter table vehicle_owners        alter column is_resident set default true;
alter table leases                alter column is_current  set default true;
alter table lease_lessees         alter column is_current  set default true;
alter table lease_documents       alter column is_current  set default true;
alter table lease_comments        alter column is_current  set default true;
alter table reservations          alter column is_current  set default true;

-- The function below is the existing one with a single added clause per
-- occupancy table; everything age-scoped is untouched.
CREATE OR REPLACE FUNCTION public.refresh_sync_scopes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Windows live here rather than being scattered through the function, so
  -- changing "recent" is one edit and the sync rules never mention a duration.
  occupancy_trail constant interval := '30 days';
  occupancy_ahead constant interval := '30 days';
  rounds_window   constant interval := '7 days';
  work_window     constant interval := '90 days';
  log_window      constant interval := '30 days';
  admin_window    constant interval := '30 days';
  -- How long a row stays in scope purely for being new. See the migration
  -- that introduced it: 20260920000100.
  new_row_grace   constant interval := '30 days';
begin
  -- Every update is guarded by `is distinct from`. Without it each refresh
  -- rewrites every row, and a rewrite is a replication event — an unguarded
  -- nightly job would push the entire database through the sync pipe once a
  -- day and wake every device up to re-download it.

  update leases set is_current = v.want
    from (select id,
                 (start_date is null or start_date <= now())
             and (end_date   is null or end_date   >= now() - occupancy_trail)
              or coalesce(created_at >= now() - new_row_grace, false) as want
            from leases) v
   where leases.id = v.id and leases.is_current is distinct from v.want;

  -- Reservations look forward as well as back: a guard starting a shift needs
  -- tomorrow's arrivals, not only yesterday's departures.
  update reservations set is_current = v.want
    from (select id,
                 expected_checkout >= now() - occupancy_trail
             and expected_checkin  <= now() + occupancy_ahead
              or coalesce(created_at >= now() - new_row_grace, false) as want
            from reservations) v
   where reservations.id = v.id and reservations.is_current is distinct from v.want;

  update contacts set is_resident = v.want
    from (select c.id,
                 exists (select 1 from lease_lessees ll join leases l on l.id = ll.lease_id
                          where ll.contact_id = c.id and l.is_current)
              or exists (select 1 from reservations r
                          where r.contact_id = c.id and r.is_current)
              or c.created_at >= now() - new_row_grace as want
            from contacts c) v
   where contacts.id = v.id and contacts.is_resident is distinct from v.want;

  -- A boat is resident if it sits in a slip under a current lease, or if one
  -- of its owners is. The first covers a boat whose owner is off-season.
  update boats set is_resident = v.want
    from (select b.id,
                 exists (select 1 from locations loc join leases l on l.location_id = loc.id
                          where loc.current_boat_id = b.id and l.is_current)
              or exists (select 1 from boat_owners bo join contacts c on c.id = bo.contact_id
                          where bo.boat_id = b.id and c.is_resident)
              or coalesce(b.created_at >= now() - new_row_grace, false) as want
            from boats b) v
   where boats.id = v.id and boats.is_resident is distinct from v.want;

  update vehicles set is_resident = v.want
    from (select ve.id,
                 exists (select 1 from vehicle_owners vo join contacts c on c.id = vo.contact_id
                          where vo.vehicle_id = ve.id and c.is_resident)
              or coalesce(ve.created_at >= now() - new_row_grace, false) as want
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
end $function$;
