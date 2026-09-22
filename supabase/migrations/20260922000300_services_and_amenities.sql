-- Services and Amenities: what a Location provides.
--
-- docs/audits.md § Services and Amenities; docs/data-model.md § Services &
-- amenities; docs/adr/0007-meters-on-services-not-assets.md for why a
-- metered service carries its own readings rather than becoming an Asset.
--
-- Two marina-defined catalogues, each entry valid for chosen Location Types.
-- Per location, a row means "present"; a Service row also says whether it
-- works and whether it is metered. Presence changes only through an approved
-- audit Proposal or the admin location editor — never straight from a
-- Finding, because a riser under leaves is a false negative waiting to
-- happen.

create table services (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  -- kWh, gallons. Used when a location's instance is metered.
  unit     text,
  position integer not null default 0
);

create table service_location_types (
  id               uuid primary key default gen_random_uuid(),
  service_id       uuid not null references services(id) on delete cascade,
  location_type_id uuid not null references location_types(id) on delete cascade,
  unique (service_id, location_type_id)
);

create table amenities (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  position integer not null default 0
);

create table amenity_location_types (
  id               uuid primary key default gen_random_uuid(),
  amenity_id       uuid not null references amenities(id) on delete cascade,
  location_type_id uuid not null references location_types(id) on delete cascade,
  unique (amenity_id, location_type_id)
);

create table location_services (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  service_id  uuid not null references services(id) on delete cascade,
  working     boolean not null default true,
  metered     boolean not null default false,
  note        text,
  unique (location_id, service_id)
);
create index location_services_service_idx on location_services (service_id);

create table location_amenities (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  amenity_id  uuid not null references amenities(id) on delete cascade,
  note        text,
  unique (location_id, amenity_id)
);
create index location_amenities_amenity_idx on location_amenities (amenity_id);

-- History only: no rule fires from these. The billed party is derived later
-- from the Lease or Reservation active at read_at. A reset row marks a
-- replaced or zeroed meter so consumption is never computed across it.
create table service_meter_readings (
  id                  uuid primary key default gen_random_uuid(),
  location_service_id uuid not null references location_services(id) on delete cascade,
  value               numeric not null,
  read_at             timestamptz not null default now(),
  read_by_id          uuid references users(id),
  reset               boolean not null default false,
  is_recent           boolean not null default true
);
create index service_meter_readings_ls_idx on service_meter_readings (location_service_id, read_at desc);

-- RLS: the enable-everything loop and the Tier 0 policy loop in 001600 ran
-- before these tables existed, so they get both explicitly. Catalogue and
-- validity are manage_locations to write; per-location rows are Tier 0 so a
-- Finding can flip `working` and set a note from the dock.
do $$
declare t text;
begin
  foreach t in array array['services','service_location_types','amenities','amenity_location_types',
                           'location_services','location_amenities','service_meter_readings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy tier0_select on public.%I for select using (public.is_active_marina_user())', t);
  end loop;
  foreach t in array array['services','service_location_types','amenities','amenity_location_types']
  loop
    execute format($f$
      create policy catalogue_write on public.%I for all
        using (public.has_permission('manage_locations'))
        with check (public.has_permission('manage_locations'))
    $f$, t);
  end loop;
  foreach t in array array['location_services','location_amenities','service_meter_readings']
  loop
    execute format($f$
      create policy tier0_insert on public.%I for insert with check (public.is_active_marina_user());
      create policy tier0_update on public.%I for update using (public.is_active_marina_user())
                                                   with check (public.is_active_marina_user());
      create policy tier0_delete on public.%I for delete using (public.is_active_marina_user());
    $f$, t, t, t);
  end loop;
end $$;
