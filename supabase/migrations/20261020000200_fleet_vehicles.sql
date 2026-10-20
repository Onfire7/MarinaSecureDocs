-- Fleet Vehicles: the marina's own trucks, vans and carts, signed out and in
-- from the Dashboard's Fleet card (src/pages/home/FleetCard.spec.md).
--
-- A Fleet Vehicle is an ordinary Asset with a flag. Its checkouts are ordinary
-- asset_checkouts rows that also carry the odometer at each end, the fuel
-- level it came back with, and anything the driver had to report. Fill-ups are
-- the one new record. Everything here is additive: existing assets are not
-- fleet, and existing checkouts have none of the new columns.

-- ── the flag ─────────────────────────────────────────────────────────────
-- A fleet vehicle is checked out by definition; one that couldn't be would sit
-- on the card with nothing to do.
alter table assets
  add column is_fleet boolean not null default false,
  add constraint assets_fleet_is_checkoutable check (not is_fleet or checkoutable);

-- ── what a trip records ──────────────────────────────────────────────────
-- numeric to match assets.meter_reading. fuel_level_in is in quarters of a
-- tank: 0 = empty, 4 = full. All nullable, since only the Fleet card asks.
alter table asset_checkouts
  add column odometer_out  numeric,
  add column odometer_in   numeric,
  add column fuel_level_in smallint,
  add column return_note   text,
  add constraint asset_checkouts_fuel_level_in_range check (fuel_level_in between 0 and 4);

-- ── fill-ups ─────────────────────────────────────────────────────────────
-- Evidence of money spent, so it outlives nothing silently: deleting a vehicle
-- with fill-ups is refused, like its other history
-- (20260826002500_restrict_evidentiary_deletes).
create table asset_fuel_logs (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references assets(id) on delete restrict,
  gallons      numeric not null check (gallons > 0),
  -- In the marina's own currency; there is no currency column anywhere.
  cost         numeric check (cost >= 0),
  odometer     numeric,
  timestamp    timestamptz not null default now(),
  logged_by_id uuid references users(id)
);
create index asset_fuel_logs_asset_idx on asset_fuel_logs (asset_id, timestamp desc);

-- Tier 0, like the rest of an asset's history. The policy loop in 001600 ran
-- before this table existed, so it gets RLS and policies explicitly. use_fleet
-- is enforced in the interface only (docs/permissions.md § Enforcement).
alter table public.asset_fuel_logs enable row level security;
create policy tier0_select on public.asset_fuel_logs for select using (public.is_active_marina_user());
create policy tier0_insert on public.asset_fuel_logs for insert with check (public.is_active_marina_user());
create policy tier0_update on public.asset_fuel_logs for update using (public.is_active_marina_user())
                                                         with check (public.is_active_marina_user());
create policy tier0_delete on public.asset_fuel_logs for delete using (public.is_active_marina_user());
-- 001900's revoke from anon covered the tables that existed then.
revoke all on public.asset_fuel_logs from anon;

-- ── Security gets use_fleet ──────────────────────────────────────────────
-- Role defaults are data, so the predefined Security role is granted here.
-- Idempotent, and a marina with no role of that name is left alone; any other
-- role is granted it in Admin → Roles. user_permissions follows by trigger.
update roles
   set allow = array_append(allow, 'use_fleet')
 where name = 'Security'
   and not ('use_fleet' = any (allow));
