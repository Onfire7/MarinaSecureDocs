-- Assets, their maintenance rules, and their logs.

create table assets (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  category               text,
  -- Not exclusive occupancy: a location holds many assets at once.
  location_id            uuid references locations(id) on delete set null,
  has_meter              boolean not null default false,
  meter_type             meter_type,
  meter_reading          numeric,
  checkoutable           boolean not null default false,
  reservation_enabled    boolean not null default false,
  reservation_visibility visibility,
  post_return_status_id  uuid references asset_statuses(id)
  -- NOTE: no current_status column. It denormalised the newest
  -- asset_status_logs row; that table is always-resident and tiny, so the
  -- device derives it with `order by timestamp desc limit 1`. No trigger, no
  -- client-side dual write, and no window in which an asset lies about itself.
);

-- Was a jsonb array on the asset. maintenanceRules.ts queries these to decide
-- when a ticket fires, which wants `where kind = 'time'` rather than unpacking
-- a blob per asset.
create table maintenance_rules (
  id       uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  kind     maintenance_kind not null,
  every    numeric not null check (every > 0),
  label    text
);
create index maintenance_rules_asset_idx on maintenance_rules (asset_id);

create table asset_status_logs (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references assets(id) on delete cascade,
  status_id    uuid references asset_statuses(id),
  note         text,
  timestamp    timestamptz not null default now(),
  logged_by_id uuid references users(id)
);
create index asset_status_logs_asset_idx on asset_status_logs (asset_id, timestamp desc);

create table asset_checkouts (
  id                 uuid primary key default gen_random_uuid(),
  asset_id           uuid not null references assets(id) on delete cascade,
  person_id          uuid references contacts(id),
  checked_out_by_id  uuid references users(id),
  time_out           timestamptz not null default now(),
  -- Null while the asset is still out.
  time_in            timestamptz
);
create index asset_checkouts_open_idx on asset_checkouts (asset_id) where time_in is null;

create table asset_meter_readings (
  id                uuid primary key default gen_random_uuid(),
  asset_id          uuid not null references assets(id) on delete cascade,
  value             numeric not null,
  source            meter_source not null,
  timestamp         timestamptz not null default now(),
  -- Required when the value is below the previous reading.
  correction_reason text,
  logged_by_id      uuid references users(id)
);
create index asset_meter_readings_asset_idx on asset_meter_readings (asset_id, timestamp desc);
