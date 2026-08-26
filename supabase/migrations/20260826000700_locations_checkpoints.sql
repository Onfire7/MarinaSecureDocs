-- Locations, maps, checkpoints, tours and check-ins.

create table locations (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  location_type_id           uuid not null references location_types(id),
  parent_id                  uuid references locations(id) on delete set null,
  -- Null when the type does not track status (tracks_status = false).
  status_id                  uuid references location_statuses(id),
  post_reservation_status_id uuid references location_statuses(id),
  reservation_enabled        boolean not null default false,
  reservation_visibility     visibility,
  -- Per-location lease switch, mirroring reservation_enabled: on one dock the
  -- front slips may be reservable and the back ones leasable.
  lease_enabled              boolean not null default false,
  gps_lat                    double precision,
  gps_lng                    double precision,
  -- Exclusive occupancy — one boat, one slip. Unlike assets, which are many.
  current_boat_id            uuid unique references boats(id) on delete set null,
  current_vehicle_id         uuid unique references vehicles(id) on delete set null
);
create index locations_parent_idx on locations (parent_id);
create index locations_type_idx on locations (location_type_id);

create table marina_maps (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  -- Required: every map is scoped to a location; root locations carry
  -- overview maps.
  scope_id             uuid not null references locations(id) on delete cascade,
  image_attachment_id  uuid references attachments(id) on delete set null
);

create table location_map_placements (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references marina_maps(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  -- {cx, cy, rotation, fontSize?, paddingX?, paddingY?} — centre point as
  -- percentages of the map image. Opaque presentation state read only by the
  -- map renderer, so it stays jsonb.
  placement   jsonb not null,
  unique (map_id, location_id)
);

create table checkpoints (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  -- The NFC/QR deep-link target (/checkin/:guid_url).
  guid_url               text not null unique,
  location_id            uuid references locations(id) on delete set null,
  gps_lat                double precision,
  gps_lng                double precision,
  -- Metres; overrides marina_settings.gps_validation_radius_default.
  gps_validation_radius  integer
);
create index checkpoints_location_idx on checkpoints (location_id);

create table tours (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  mode tour_mode not null default 'freeform'
);

-- Ordering lives in a column, not in a sibling json array of ids beside an
-- unordered link set. A junction row cannot drift out of sync with its own
-- membership the way the array could.
create table tour_checkpoints (
  tour_id       uuid not null references tours(id) on delete cascade,
  checkpoint_id uuid not null references checkpoints(id) on delete cascade,
  position      integer not null,
  primary key (tour_id, checkpoint_id)
);

create table check_ins (
  id            uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references checkpoints(id) on delete cascade,
  user_id       uuid not null references users(id),
  timestamp     timestamptz not null default now(),
  method        checkin_method not null,
  -- Required when method = 'manual'.
  reason        text,
  gps_lat       double precision,
  gps_lng       double precision,
  within_radius boolean,
  constraint manual_checkin_needs_reason
    check (method <> 'manual' or reason is not null)
);
create index check_ins_timestamp_idx on check_ins (timestamp desc);
create index check_ins_checkpoint_idx on check_ins (checkpoint_id, timestamp desc);
