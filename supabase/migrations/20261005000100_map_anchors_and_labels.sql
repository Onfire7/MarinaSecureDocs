-- Anchors and labels are two things (docs/maps.md; owner, 2026-10-05).
--
-- A placement used to be one jsonb blob per location per map: the anchor -
-- where the location IS, the point its GPS fix is tied to and the fit is
-- built from - with the label hanging off it by an offset. Two needs broke
-- that: anchors that belong to no location (a dock corner, a gate) so a map
-- can be calibrated where nothing is plotted, and labels whose coordinates
-- are their own, so moving an anchor does not drag its label.
--
--   map_anchors  the fit. One per (map, location), or free (no location),
--                each with the GPS it stands for. A located anchor's lat/lng
--                mirror the location's and are kept in step by trigger, in
--                both directions, so the fit reads one table and the rest of
--                the app keeps reading locations.gps_*.
--   map_labels   decoration. One per (map, location): an absolute centre,
--                rotation and size. Nothing else reads it.
--
-- Every placement migrates: its anchor becomes a map_anchor with the
-- location's coordinates; its label becomes a map_label at anchor + offset.
-- Proposals keep the kind `move_placement`; the payload may be the old
-- {map_id, placement} or the new {map_id, anchor, label}, and the finalizer
-- takes either, so the twenty pending today apply unchanged.

create table map_anchors (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references marina_maps(id) on delete cascade,
  -- Null for a free calibration point.
  location_id uuid references locations(id) on delete cascade,
  -- Percent of the map image, x to the right, y down.
  cx          double precision not null check (cx between 0 and 100),
  cy          double precision not null check (cy between 0 and 100),
  lat         double precision check (lat is null or lat between -90 and 90),
  lng         double precision check (lng is null or lng between -180 and 180),
  -- What a free point is called in the fit report ("NE dock corner").
  label       text,
  created_at  timestamptz not null default now()
);
create unique index map_anchors_location_idx on map_anchors (map_id, location_id) where location_id is not null;
create index map_anchors_map_idx on map_anchors (map_id);

create table map_labels (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references marina_maps(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  cx          double precision not null check (cx between 0 and 100),
  cy          double precision not null check (cy between 0 and 100),
  rotation    double precision not null default 0,
  font_size   integer,
  padding_x   integer,
  padding_y   integer,
  unique (map_id, location_id)
);
create index map_labels_map_idx on map_labels (map_id);

-- ── migrate ──────────────────────────────────────────────────────────────
insert into map_anchors (map_id, location_id, cx, cy, lat, lng)
select p.map_id, p.location_id,
       least(100, greatest(0, (p.placement->>'cx')::double precision)),
       least(100, greatest(0, (p.placement->>'cy')::double precision)),
       l.gps_lat, l.gps_lng
  from location_map_placements p
  join locations l on l.id = p.location_id
 where p.placement ? 'cx' and p.placement ? 'cy';

insert into map_labels (map_id, location_id, cx, cy, rotation, font_size, padding_x, padding_y)
select p.map_id, p.location_id,
       least(100, greatest(0, (p.placement->>'cx')::double precision + coalesce((p.placement->>'dx')::double precision, 0))),
       least(100, greatest(0, (p.placement->>'cy')::double precision + coalesce((p.placement->>'dy')::double precision, 0))),
       coalesce((p.placement->>'rotation')::double precision, 0),
       (p.placement->>'fontSize')::integer, (p.placement->>'paddingX')::integer, (p.placement->>'paddingY')::integer
  from location_map_placements p
 where p.placement ? 'cx' and p.placement ? 'cy';

-- ── a located anchor and its location agree on the coordinates ──────────
create function public.sync_anchor_from_location() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.gps_lat is distinct from old.gps_lat or new.gps_lng is distinct from old.gps_lng then
    update map_anchors set lat = new.gps_lat, lng = new.gps_lng where location_id = new.id;
  end if;
  return new;
end $$;
create trigger locations_sync_anchor after update of gps_lat, gps_lng on locations
  for each row execute function public.sync_anchor_from_location();

create function public.sync_location_from_anchor() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or new.location_id is null then return new; end if;
  if tg_op = 'INSERT' and new.lat is null and new.lng is null then
    -- A new located anchor without coordinates takes the location's.
    select gps_lat, gps_lng into new.lat, new.lng from locations where id = new.location_id;
    return new;
  end if;
  if new.lat is not null and new.lng is not null then
    update locations set gps_lat = new.lat, gps_lng = new.lng
     where id = new.location_id and (gps_lat is distinct from new.lat or gps_lng is distinct from new.lng);
  end if;
  return new;
end $$;
create trigger map_anchors_sync_location before insert or update of lat, lng, location_id on map_anchors
  for each row execute function public.sync_location_from_anchor();

-- ── permissions: read for every marina user, write with manage_locations ─
do $$
declare t text;
begin
  foreach t in array array['map_anchors','map_labels']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy tier0_select on public.%I for select using (public.is_active_marina_user())', t);
    execute format($f$
      create policy catalogue_write on public.%I for all
        using (public.has_permission('manage_locations'))
        with check (public.has_permission('manage_locations'))
    $f$, t);
  end loop;
end $$;

-- ── applying a move_placement proposal, either payload shape ────────────
create function public.apply_map_placement(p_map uuid, p_location uuid, p_payload jsonb) returns void
  language plpgsql security definer set search_path = public
as $$
declare
  a_cx double precision; a_cy double precision;
  l    jsonb;
  l_cx double precision; l_cy double precision;
begin
  if p_payload ? 'placement' then
    -- Legacy: one shape, anchor at cx/cy, label at cx+dx/cy+dy.
    a_cx := (p_payload->'placement'->>'cx')::double precision;
    a_cy := (p_payload->'placement'->>'cy')::double precision;
    l := p_payload->'placement';
    l_cx := a_cx + coalesce((l->>'dx')::double precision, 0);
    l_cy := a_cy + coalesce((l->>'dy')::double precision, 0);
  else
    a_cx := (p_payload->'anchor'->>'cx')::double precision;
    a_cy := (p_payload->'anchor'->>'cy')::double precision;
    l := p_payload->'label';
    l_cx := (l->>'cx')::double precision;
    l_cy := (l->>'cy')::double precision;
  end if;
  if a_cx is not null and a_cy is not null then
    insert into map_anchors (map_id, location_id, cx, cy)
    values (p_map, p_location, least(100, greatest(0, a_cx)), least(100, greatest(0, a_cy)))
    on conflict (map_id, location_id) where location_id is not null
    do update set cx = excluded.cx, cy = excluded.cy;
  end if;
  if l is not null and l_cx is not null and l_cy is not null then
    insert into map_labels (map_id, location_id, cx, cy, rotation, font_size, padding_x, padding_y)
    values (p_map, p_location, least(100, greatest(0, l_cx)), least(100, greatest(0, l_cy)),
            coalesce((l->>'rotation')::double precision, 0),
            (l->>'fontSize')::integer, (l->>'paddingX')::integer, (l->>'paddingY')::integer)
    on conflict (map_id, location_id)
    do update set cx = excluded.cx, cy = excluded.cy, rotation = excluded.rotation,
                  font_size = excluded.font_size, padding_x = excluded.padding_x, padding_y = excluded.padding_y;
  end if;
end $$;
revoke execute on function public.apply_map_placement(uuid, uuid, jsonb) from public, anon, authenticated;

-- finalize_audit: the move_placement case goes through apply_map_placement,
-- and a no-history retirement drops anchors and labels (the cascade would
-- too; this keeps the intent visible). The body is otherwise 20260922000400's.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.finalize_audit(uuid)'::regprocedure);
  src := replace(src,
    $old$        insert into location_map_placements (map_id, location_id, placement)
        values ((p.payload->>'map_id')::uuid, loc, p.payload->'placement')
        on conflict (map_id, location_id) do update set placement = excluded.placement;$old$,
    $new$        perform public.apply_map_placement((p.payload->>'map_id')::uuid, loc, p.payload);$new$);
  src := replace(src,
    $old$          delete from location_map_placements where location_id = loc;$old$,
    $new$          delete from map_anchors where location_id = loc;
          delete from map_labels where location_id = loc;$new$);
  if position('location_map_placements' in src) > 0 then
    raise exception 'finalize_audit still refers to location_map_placements after rewrite';
  end if;
  execute src;
end $$;

-- build_audit_report strips the noisy keys from a proposal's payload for
-- display; the new payload has two more.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.build_audit_report(uuid)'::regprocedure);
  src := replace(src, $old$- 'placement' - 'map_id')$old$, $new$- 'placement' - 'map_id' - 'anchor' - 'label')$new$);
  execute src;
end $$;

drop table location_map_placements;
