-- Notes, incidents and tickets — the three attachable entities.
--
-- Each attaches to EXACTLY ONE of six targets. In the InstantDB schema this
-- was six optional links with the rule enforced in application code, and one
-- of seven real tickets violated it. num_nonnulls(...) = 1 makes the invariant
-- unbreakable; that row is dropped at migration rather than carried.
--
-- Only two arms (location, asset) appear in real data. boat, vehicle, contact
-- and checkpoint are being designed against empty tables — see ADR 0005.

create table notes (
  id            uuid primary key default gen_random_uuid(),
  body          text not null,
  created_at    timestamptz not null default now(),
  author_id     uuid references users(id),
  location_id   uuid references locations(id)   on delete cascade,
  checkpoint_id uuid references checkpoints(id) on delete cascade,
  boat_id       uuid references boats(id)       on delete cascade,
  vehicle_id    uuid references vehicles(id)    on delete cascade,
  contact_id    uuid references contacts(id)    on delete cascade,
  asset_id      uuid references assets(id)      on delete cascade,
  constraint notes_exactly_one_target check (
    num_nonnulls(location_id, checkpoint_id, boat_id, vehicle_id, contact_id, asset_id) = 1
  )
);

create table incidents (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  incident_type_id uuid references incident_types(id),
  status_id        uuid not null references incident_statuses(id),
  details          text,                     -- markdown
  created_at       timestamptz not null default now(),
  author_id        uuid references users(id),
  assigned_to_id   uuid references users(id),
  location_id      uuid references locations(id)   on delete cascade,
  checkpoint_id    uuid references checkpoints(id) on delete cascade,
  boat_id          uuid references boats(id)       on delete cascade,
  vehicle_id       uuid references vehicles(id)    on delete cascade,
  contact_id       uuid references contacts(id)    on delete cascade,
  asset_id         uuid references assets(id)      on delete cascade,
  constraint incidents_exactly_one_target check (
    num_nonnulls(location_id, checkpoint_id, boat_id, vehicle_id, contact_id, asset_id) = 1
  )
);
create index incidents_created_idx on incidents (created_at desc);
create index incidents_status_idx on incidents (status_id);

create table incident_comments (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  body        text not null,                -- markdown
  created_at  timestamptz not null default now(),
  author_id   uuid references users(id)
);
create index incident_comments_incident_idx on incident_comments (incident_id, created_at);

create table tickets (
  id                        uuid primary key default gen_random_uuid(),
  title                     text not null,
  description               text,           -- markdown
  priority                  ticket_priority not null default 'medium',
  status_id                 uuid not null references ticket_statuses(id),
  auto_generated            boolean not null default false,
  created_at                timestamptz not null default now(),
  resolved_at               timestamptz,
  created_by_id             uuid references users(id),
  assigned_to_id            uuid references users(id),
  source_incident_id        uuid references incidents(id) on delete set null,
  source_checklist_item_id  uuid references checklist_instance_items(id) on delete set null,
  location_id               uuid references locations(id)   on delete cascade,
  checkpoint_id             uuid references checkpoints(id) on delete cascade,
  boat_id                   uuid references boats(id)       on delete cascade,
  vehicle_id                uuid references vehicles(id)    on delete cascade,
  contact_id                uuid references contacts(id)    on delete cascade,
  asset_id                  uuid references assets(id)      on delete cascade,
  constraint tickets_exactly_one_target check (
    num_nonnulls(location_id, checkpoint_id, boat_id, vehicle_id, contact_id, asset_id) = 1
  )
);
create index tickets_created_idx on tickets (created_at desc);
create index tickets_status_idx on tickets (status_id);
create index tickets_priority_idx on tickets (priority);

-- Ticket creation is deliberately ungated: every role may raise one, and there
-- is no create_ticket permission. See docs/permissions.md.
