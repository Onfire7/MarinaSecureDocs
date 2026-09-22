-- Admin-extensible lookups.
--
-- These replace free-text status columns and, in the incident case, a shadow
-- `custom_status` column that existed beside `status` purely because the type
-- could not express an admin-defined set. A lookup table gives the admin UI
-- rows instead of migrations, lets a foreign key enforce validity, and leaves
-- room for attributes a bare string cannot carry.

create table location_statuses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  -- Whether this status counts as available for booking.
  is_vacancy boolean not null default false,
  position   integer not null default 0
);

create table incident_statuses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_terminal boolean not null default false,
  position    integer not null default 0
);

create table ticket_statuses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_terminal boolean not null default false,
  position    integer not null default 0
);

create table asset_statuses (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  position integer not null default 0
);

create table incident_types (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table location_types (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  allows_reservations boolean not null default false,
  allows_leases       boolean not null default false,
  has_boat            boolean not null default false,
  has_vehicle         boolean not null default false,
  -- Off for organisational containers — a root property, or a dock that only
  -- groups slips, would otherwise read a meaningless "Vacant".
  tracks_status       boolean not null default false
);

-- Which types may nest inside which.
create table location_type_parents (
  parent_type_id uuid not null references location_types(id) on delete cascade,
  child_type_id  uuid not null references location_types(id) on delete cascade,
  primary key (parent_type_id, child_type_id)
);
