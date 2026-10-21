-- The Fleet Vehicle Item: taking, checking and returning a Fleet Vehicle from
-- inside a checklist, and the End of Shift step for a vehicle still out
-- (src/pages/checklists/ActiveChecklistPage.spec.md § Fleet Vehicle Item).
-- Also the template trigger that fires when an Asset is checked out or in
-- (src/pages/admin/AdminChecklistTemplatesPage.spec.md § Asset triggers).
--
-- All additive. Both tables touched already sync with SELECT *, so the sync
-- rules need no change.

-- ── types ────────────────────────────────────────────────────────────────
-- section_trigger already has 'asset'; whether a section fires on check-out
-- or check-in lives in its trigger_config, as {"event": "check_out"}.
alter type checklist_item_type add value if not exists 'fleet_vehicle';
alter type template_trigger add value if not exists 'asset';

-- ── fuel level readings ──────────────────────────────────────────────────
-- A Status Check records the level without a fill-up, so gallons stops being
-- required and the row gains the level itself (quarters of a tank, as
-- asset_checkouts.fuel_level_in). A fill-up may carry its level too. Rows
-- from before are fill-ups with no level, which the gauge reads as full.
alter table asset_fuel_logs
  alter column gallons drop not null,
  add column level smallint,
  add constraint asset_fuel_logs_level_range check (level between 0 and 4),
  add constraint asset_fuel_logs_gallons_or_level check (gallons is not null or level is not null);

-- ── kept vehicles ────────────────────────────────────────────────────────
-- A guard who keeps a vehicle past End of Shift closes its checkout there,
-- with the readings and the reason, and a new one opens to them at the same
-- moment. This marks the new one, so the Shift Report reads the pair as kept
-- rather than returned and taken again.
alter table asset_checkouts
  add column kept_after_shift boolean not null default false;
