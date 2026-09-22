-- Deleting configuration must not silently destroy evidence.
--
-- Notes, incidents, tickets, leases, reservations and asset history are
-- independent records: they describe something that HAPPENED, and they outlive
-- the configuration row they hang off. Cascading them meant deleting a cabin
-- silently removed its reservations, and deleting a dock removed every
-- incident ever raised on it — with no error and no trace.
--
-- The activity log does not backstop this. It stores a one-line summary, not
-- the incident's details or its comments, it has no `notes` subject type at
-- all, and it is itself purged on a retention timer (0 of 367 real entries are
-- protected). The most deletable table in the schema cannot be the permanent
-- copy of everything else.
--
-- RESTRICT is deliberately temporary. docs/ROADMAP.md records the Records
-- Archive: deletion moves server-side, exports the full cascade to an archived
-- snapshot, and only then deletes. Once that exists, these go back to CASCADE
-- in a one-line migration and the archive is what earns it. Until then, an
-- admin gets "you can't delete Dock C, it has 14 incidents attached", which is
-- useful information rather than a loss.
--
-- Composition is untouched: an incident_comment, a call_note, an sms_message
-- and a contact_details row have no meaning without their parent, so they
-- still cascade.

do $$
declare
  fk record;
  -- (child table, column, parent table). Named explicitly rather than derived,
  -- so this list can be audited against the ROADMAP entry.
  targets text[][] := array[
    ['notes','location_id','locations'],     ['notes','checkpoint_id','checkpoints'],
    ['notes','boat_id','boats'],             ['notes','vehicle_id','vehicles'],
    ['notes','contact_id','contacts'],       ['notes','asset_id','assets'],
    ['incidents','location_id','locations'], ['incidents','checkpoint_id','checkpoints'],
    ['incidents','boat_id','boats'],         ['incidents','vehicle_id','vehicles'],
    ['incidents','contact_id','contacts'],   ['incidents','asset_id','assets'],
    ['tickets','location_id','locations'],   ['tickets','checkpoint_id','checkpoints'],
    ['tickets','boat_id','boats'],           ['tickets','vehicle_id','vehicles'],
    ['tickets','contact_id','contacts'],     ['tickets','asset_id','assets'],
    ['leases','location_id','locations'],
    ['reservations','location_id','locations'], ['reservations','asset_id','assets'],
    ['asset_status_logs','asset_id','assets'],
    ['asset_checkouts','asset_id','assets'],
    ['asset_meter_readings','asset_id','assets'],
    -- Currently SET NULL, which silently reparents every slip on a deleted
    -- dock to nothing. A 40-slip dock vanishing into the root is not a
    -- deletion anyone intended.
    ['locations','parent_id','locations']
  ];
  t text[];
begin
  foreach t slice 1 in array targets loop
    execute format('alter table public.%I drop constraint %I', t[1], t[1] || '_' || t[2] || '_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete restrict',
      t[1], t[1] || '_' || t[2] || '_fkey', t[2], t[3]);
  end loop;
end $$;
