-- Occupancy lives on the boat and vehicle, not on the location.
--
-- locations.current_boat_id / current_vehicle_id were UNIQUE foreign keys:
-- one boat per slip, one vehicle per site, enforced by the database and
-- recorded in docs/data-model.md as deliberate. The location audit design
-- reversed it (docs/adr/0006-occupancy-lives-on-the-occupant.md): a campsite
-- routinely holds a car and a trailer, a boathouse several boats, and an
-- auditor standing there must be able to record what is actually present.
-- The one-occupant columns made the second vehicle unrepresentable.
--
-- A boat still has at most one location, so a boat recorded in a new slip
-- still vacates its old one; that stays true because the pointer is on the
-- boat. What is gone is the guarantee that a location holds at most one.
--
-- Also here, because the audit work needs them and they are small:
--   locations.retired_at        an approved removal retires, never deletes,
--                               a location with history (docs/audits.md)
--   marina_settings.audit_gps_* the two GPS thresholds the audit prompt uses

alter table boats    add column location_id uuid references locations(id) on delete set null;
alter table vehicles add column location_id uuid references locations(id) on delete set null;
create index boats_location_idx    on boats (location_id);
create index vehicles_location_idx on vehicles (location_id);

update boats b set location_id = l.id from locations l where l.current_boat_id = b.id;
update vehicles v set location_id = l.id from locations l where l.current_vehicle_id = v.id;

alter table locations drop column current_boat_id;
alter table locations drop column current_vehicle_id;

alter table locations add column retired_at timestamptz;
create index locations_retired_idx on locations (id) where retired_at is not null;

alter table marina_settings
  add column audit_gps_radius   integer not null default 15,
  add column audit_gps_accuracy integer not null default 10;

-- refresh_sync_scopes() read locations.current_boat_id to decide whether a
-- boat sits under a current lease. Same rule, read from the boat's side.
-- Everything else in the function is unchanged from 20260920000100.
CREATE OR REPLACE FUNCTION public.refresh_sync_scopes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  occupancy_trail constant interval := '30 days';
  occupancy_ahead constant interval := '30 days';
  rounds_window   constant interval := '7 days';
  work_window     constant interval := '90 days';
  log_window      constant interval := '30 days';
  admin_window    constant interval := '30 days';
  new_row_grace   constant interval := '30 days';
begin
  update leases set is_current = v.want
    from (select id,
                 (start_date is null or start_date <= now())
             and (end_date   is null or end_date   >= now() - occupancy_trail)
              or coalesce(created_at >= now() - new_row_grace, false) as want
            from leases) v
   where leases.id = v.id and leases.is_current is distinct from v.want;

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

  -- A boat is resident if it sits in a location under a current lease, or if
  -- one of its owners is. The first covers a boat whose owner is off-season.
  update boats set is_resident = v.want
    from (select b.id,
                 exists (select 1 from leases l
                          where l.location_id = b.location_id and l.is_current)
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
