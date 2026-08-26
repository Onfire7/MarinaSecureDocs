-- Contacts, boats and vehicles.
--
-- contacts is split in two. view_owner (knowing who someone is) and
-- view_contact (seeing how to reach them) govern the same row's *different
-- columns*, which RLS cannot express — it is row-level. Splitting means a user
-- holding view_owner but not view_contact never receives the details rows at
-- all, which is what makes the boundary hold on a phone in a dead zone rather
-- than only inside a query. See docs/permissions.md.

create table contacts (
  id             uuid primary key default gen_random_uuid(),
  -- Nullable until the nameless-contact prompt fills it: an inbound call from
  -- an unknown number creates the record before anyone knows who called.
  name           text,
  -- Merging never rewrites references; it sets this and every display resolves
  -- through it, so a merged number still matches on the next inbound call.
  merged_into_id uuid references contacts(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index contacts_merged_into_idx on contacts (merged_into_id) where merged_into_id is not null;

create table contact_details (
  contact_id uuid primary key references contacts(id) on delete cascade,
  phone      text,
  email      text,
  address    text
);
create index contact_details_phone_idx on contact_details (phone) where phone is not null;

-- A User may also be reachable as a Contact (asset checkout, for instance).
alter table users add column contact_id uuid references contacts(id) on delete set null;

create table boats (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  length              numeric,
  make                text,
  model               text,
  registration_number text
);

-- Ordered succession, replacing a json array of ids that sat beside an
-- unordered link set and could drift out of sync with it.
create table boat_owners (
  boat_id    uuid not null references boats(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  position   integer not null,
  primary key (boat_id, contact_id)
);

create table boat_authorized_users (
  boat_id    uuid not null references boats(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  primary key (boat_id, contact_id)
);

create table vehicles (
  id           uuid primary key default gen_random_uuid(),
  -- The primary label: staff know a vehicle by sight, not by plate.
  description  text not null,
  plate_number text
);
create index vehicles_plate_idx on vehicles (plate_number) where plate_number is not null;

create table vehicle_owners (
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  position   integer not null,
  primary key (vehicle_id, contact_id)
);
