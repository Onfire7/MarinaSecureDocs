-- Leases and reservations.
--
-- The date columns here are load-bearing beyond the UI: they define the
-- OCCUPANCY sync scope. Contacts and boats reach a device because they are
-- attached to a lease or a reservation that is current (plus a 30-day trailing
-- window). See docs/architecture.md — What is resident.

create table leases (
  id                        uuid primary key default gen_random_uuid(),
  location_id               uuid not null references locations(id) on delete cascade,
  start_date                timestamptz,
  end_date                  timestamptz,
  variances_and_conditions  text
);
create index leases_location_idx on leases (location_id);
-- Drives occupancy scoping; the sync stream filters on the window.
create index leases_window_idx on leases (start_date, end_date);

create table lease_lessees (
  lease_id   uuid not null references leases(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  primary key (lease_id, contact_id)
);

create table lease_documents (
  lease_id      uuid not null references leases(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  primary key (lease_id, attachment_id)
);

create table lease_comments (
  id         uuid primary key default gen_random_uuid(),
  lease_id   uuid not null references leases(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  author_id  uuid references users(id)
);

create table reservations (
  id                 uuid primary key default gen_random_uuid(),
  status             reservation_status not null default 'requested',
  contact_id         uuid not null references contacts(id),
  location_id        uuid references locations(id) on delete cascade,
  asset_id           uuid references assets(id) on delete cascade,
  -- Defaults from the target's visibility; an explicit value always wins.
  billing_type       billing_type,
  expected_checkin   timestamptz,
  expected_checkout  timestamptz,
  actual_checkin     timestamptz,
  actual_checkout    timestamptz,
  -- Ignored when non-billable.
  early_checkin      timestamptz,
  late_checkout      timestamptz,
  rate               numeric,
  deposit            numeric,
  balance            numeric,
  constraint reservation_has_exactly_one_target
    check (num_nonnulls(location_id, asset_id) = 1)
);
create index reservations_window_idx on reservations (expected_checkin, expected_checkout);
create index reservations_contact_idx on reservations (contact_id);
create index reservations_status_idx on reservations (status);
