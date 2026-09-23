-- Attributes: numeric facts about what a Location will accept.
--
-- A third catalogue alongside Services and Amenities (docs/audits.md
-- § Services and Amenities), for facts that are a number rather than a
-- presence — maximum boat length, maximum vehicle length. Same shape as the
-- other two: marina-defined entries, each valid for chosen Location Types,
-- a value per Location. Unlike a Service's `working` flag, there is nothing
-- to toggle at the dock without review — the value is a capacity limit, so
-- every change from a Finding is a Proposal, never applied immediately.
-- Direct edits (the admin location editor) still need only manage_locations,
-- like the catalogue itself.

create table attributes (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  -- ft, in, lbs. Shown beside the value everywhere it's displayed.
  unit     text,
  position integer not null default 0
);

create table attribute_location_types (
  id               uuid primary key default gen_random_uuid(),
  attribute_id     uuid not null references attributes(id) on delete cascade,
  location_type_id uuid not null references location_types(id) on delete cascade,
  unique (attribute_id, location_type_id)
);

create table location_attributes (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations(id) on delete cascade,
  attribute_id uuid not null references attributes(id) on delete cascade,
  value        numeric not null,
  note         text,
  unique (location_id, attribute_id)
);
create index location_attributes_attribute_idx on location_attributes (attribute_id);

alter type audit_proposal_kind add value 'set_attribute';

do $$
declare t text;
begin
  foreach t in array array['attributes','attribute_location_types','location_attributes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy tier0_select on public.%I for select using (public.is_active_marina_user())', t);
  end loop;
  foreach t in array array['attributes','attribute_location_types']
  loop
    execute format($f$
      create policy catalogue_write on public.%I for all
        using (public.has_permission('manage_locations'))
        with check (public.has_permission('manage_locations'))
    $f$, t);
  end loop;
  -- Unlike location_services / location_amenities, there is no Tier 0 write:
  -- every change from a Finding is a Proposal applied by the security-definer
  -- finalize_audit(); a direct edit still needs manage_locations, same as
  -- the catalogue.
  execute $f$
    create policy catalogue_write on public.location_attributes for all
      using (public.has_permission('manage_locations'))
      with check (public.has_permission('manage_locations'))
  $f$;
end $$;

-- Which built-in Status-kind sections a Template asks about. Default true so
-- an existing Template keeps asking everything it always did. Copied onto
-- the Audit at launch, like the rule tree and kind, so editing a Template
-- later never reaches an audit already launched from it.
alter table audit_templates
  add column include_attributes boolean not null default true,
  add column include_services   boolean not null default true,
  add column include_amenities  boolean not null default true,
  add column include_marked     boolean not null default true,
  add column include_map        boolean not null default true;

alter table audits
  add column include_attributes boolean not null default true,
  add column include_services   boolean not null default true,
  add column include_amenities  boolean not null default true,
  add column include_marked     boolean not null default true,
  add column include_map        boolean not null default true;
