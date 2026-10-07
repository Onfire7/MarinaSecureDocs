-- Outlines on map labels (docs/maps.md; owner, 2026-10-07).
--
-- Some locations do not suit a text label on a map image that is already
-- labelled, so a location's drawing on a map may be a traced polygon -
-- shaded in its status colour - as well as, or instead of, the text.
--
--   outline    jsonb array of [x, y] pairs in percent of the image, three
--              or more; null for none.
--   show_text  draw the text label. Off only when there is an outline to
--              draw instead: a row must draw something.
--
-- No existing row changes: outline is null and show_text true.

create function public.valid_map_outline(o jsonb) returns boolean
  language sql immutable
as $$
  select o is null or (
    jsonb_typeof(o) = 'array' and jsonb_array_length(o) >= 3
    and not exists (
      select 1 from jsonb_array_elements(o) p
       where jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
          or jsonb_typeof(p->0) <> 'number' or jsonb_typeof(p->1) <> 'number'
          or (p->>0)::double precision not between 0 and 100
          or (p->>1)::double precision not between 0 and 100
    )
  )
$$;

alter table map_labels
  add column outline jsonb,
  add column show_text boolean not null default true,
  add constraint map_labels_outline_valid check (public.valid_map_outline(outline)),
  add constraint map_labels_draws_something check (show_text or outline is not null);

-- Applying a move_placement Proposal: as 20261005000100, plus the outline
-- and the text switch. A payload that names them sets them (a null outline
-- removes it); one that does not leaves what is there, so a Proposal made
-- before outlines existed cannot erase one.
create or replace function public.apply_map_placement(p_map uuid, p_location uuid, p_payload jsonb) returns void
  language plpgsql security definer set search_path = public
as $$
declare
  a_cx double precision; a_cy double precision;
  l    jsonb;
  l_cx double precision; l_cy double precision;
  has_outline boolean := false;
  has_text    boolean := false;
  v_outline   jsonb;
  v_text      boolean;
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
    if jsonb_typeof(l) = 'object' then
      has_outline := l ? 'outline';
      has_text := l ? 'showText';
      v_outline := case when jsonb_typeof(l->'outline') = 'array' then l->'outline' else null end;
      v_text := coalesce((l->>'showText')::boolean, true);
    end if;
  end if;
  if a_cx is not null and a_cy is not null then
    insert into map_anchors (map_id, location_id, cx, cy)
    values (p_map, p_location, least(100, greatest(0, a_cx)), least(100, greatest(0, a_cy)))
    on conflict (map_id, location_id) where location_id is not null
    do update set cx = excluded.cx, cy = excluded.cy;
  end if;
  if l is not null and l_cx is not null and l_cy is not null then
    insert into map_labels (map_id, location_id, cx, cy, rotation, font_size, padding_x, padding_y, outline, show_text)
    values (p_map, p_location, least(100, greatest(0, l_cx)), least(100, greatest(0, l_cy)),
            coalesce((l->>'rotation')::double precision, 0),
            (l->>'fontSize')::integer, (l->>'paddingX')::integer, (l->>'paddingY')::integer,
            v_outline, case when v_outline is null then true else coalesce(v_text, true) end)
    on conflict (map_id, location_id)
    do update set cx = excluded.cx, cy = excluded.cy, rotation = excluded.rotation,
                  font_size = excluded.font_size, padding_x = excluded.padding_x, padding_y = excluded.padding_y,
                  outline = case when has_outline then excluded.outline else map_labels.outline end,
                  show_text = case
                    when (case when has_outline then excluded.outline else map_labels.outline end) is null then true
                    when has_text then excluded.show_text
                    else map_labels.show_text end;
  end if;
end $$;
revoke execute on function public.apply_map_placement(uuid, uuid, jsonb) from public, anon, authenticated;
