-- A Share Link can show less than the whole audit.
--
-- Different readers need different parts: the ownership group wants the
-- condition of the property, a contractor wants the sites they are quoting,
-- and nobody outside the office needs the GPS fixes. So a link carries a
-- filter, and what it hides is hidden *as if the audit had never asked*.
--
-- That last part is why this lives here and not on the page. The filter is
-- applied to the compiled document before it leaves the database, so the
-- recipient's copy does not contain the hidden parts - not in the tables,
-- not in the export, not in the page source, and not in the numbers, since
-- every number in the report is derived from this document by the client.
-- Filter out Services and the report has no Services column, no "not
-- working" tile, no sentence about them, no line in Needs attention, and
-- includeServices reads false: unreadable as an omission.
--
-- Entries are named by ID and resolved to names here, never stored as
-- names. The document identifies a Service by its name, so a filter
-- written as text would stop matching the day somebody renames it - and a
-- privacy filter that stops matching fails by SHOWING what was meant to be
-- hidden.
--
--   {"categories": ["gps","tickets"],        -- occupancy attributes services
--    "services":   ["<uuid>", ...],          -- amenities questions marked map
--    "amenities":  [...], "attributes": [...],  -- gps changes tickets
--    "questions":  [...],
--    "targets":    ["<audit_targets.id>", ...]} -- empty = every location
--
-- An empty filter is the whole report.

alter table audit_shares add column filter jsonb not null default '{}'::jsonb;
comment on column audit_shares.filter is
  'What this link leaves out, by id; {} is everything. Applied by filter_audit_report() before the document is returned. See docs/audits.md § A link can show less.';

create function public.filter_audit_report(doc jsonb, f jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cats     text[];
  keep     uuid[];
  hide_svc text[]; hide_amen text[]; hide_attr text[]; hide_q text[];
  h_svc boolean; h_amen boolean; h_attr boolean; h_q boolean;
  h_marked boolean; h_map boolean; h_occ boolean; h_gps boolean; h_chg boolean; h_tick boolean;
begin
  if doc is null then return null; end if;
  if f is null or f = '{}'::jsonb then return doc; end if;

  cats := array(select x.value from jsonb_array_elements_text(coalesce(f->'categories', '[]'::jsonb)) as x(value));
  keep := array(select x.value::uuid from jsonb_array_elements_text(coalesce(f->'targets', '[]'::jsonb)) as x(value));

  -- Ids to names, now, in the same breath as the document was compiled.
  select coalesce(array_agg(s.name), '{}') into hide_svc from services s
   where s.id = any(array(select x.value::uuid from jsonb_array_elements_text(coalesce(f->'services', '[]'::jsonb)) as x(value)));
  select coalesce(array_agg(m.name), '{}') into hide_amen from amenities m
   where m.id = any(array(select x.value::uuid from jsonb_array_elements_text(coalesce(f->'amenities', '[]'::jsonb)) as x(value)));
  select coalesce(array_agg(a.name), '{}') into hide_attr from attributes a
   where a.id = any(array(select x.value::uuid from jsonb_array_elements_text(coalesce(f->'attributes', '[]'::jsonb)) as x(value)));
  select coalesce(array_agg(q.prompt), '{}') into hide_q from audit_questions q
   where q.id = any(array(select x.value::uuid from jsonb_array_elements_text(coalesce(f->'questions', '[]'::jsonb)) as x(value)));

  h_svc    := 'services'   = any(cats);
  h_amen   := 'amenities'  = any(cats);
  h_attr   := 'attributes' = any(cats);
  h_q      := 'questions'  = any(cats);
  h_marked := 'marked'     = any(cats);
  h_map    := 'map'        = any(cats);
  h_occ    := 'occupancy'  = any(cats);
  h_tick   := 'tickets'    = any(cats);
  h_chg    := 'changes'    = any(cats);
  -- GPS appears in a report only as the set_gps change, so hiding every
  -- change hides it too.
  h_gps    := h_chg or 'gps' = any(cats);

  -- The flags the reader's client renders columns from. Clearing them is
  -- what makes an omission unreadable rather than obvious.
  if h_attr   then doc := jsonb_set(doc, '{audit,includeAttributes}', 'false'::jsonb); end if;
  if h_svc    then doc := jsonb_set(doc, '{audit,includeServices}',   'false'::jsonb); end if;
  if h_amen   then doc := jsonb_set(doc, '{audit,includeAmenities}',  'false'::jsonb); end if;
  if h_marked then doc := jsonb_set(doc, '{audit,includeMarked}',     'false'::jsonb); end if;
  if h_map    then doc := jsonb_set(doc, '{audit,includeMap}',        'false'::jsonb); end if;

  doc := jsonb_set(doc, '{columns,services}', case when h_svc then '[]'::jsonb else coalesce((
    select jsonb_agg(e) from jsonb_array_elements(doc->'columns'->'services') as x(e)
     where not (e #>> '{}' = any(hide_svc))), '[]'::jsonb) end);
  doc := jsonb_set(doc, '{columns,amenities}', case when h_amen then '[]'::jsonb else coalesce((
    select jsonb_agg(e) from jsonb_array_elements(doc->'columns'->'amenities') as x(e)
     where not (e #>> '{}' = any(hide_amen))), '[]'::jsonb) end);
  doc := jsonb_set(doc, '{columns,attributes}', case when h_attr then '[]'::jsonb else coalesce((
    select jsonb_agg(e) from jsonb_array_elements(doc->'columns'->'attributes') as x(e)
     where not (e->>'name' = any(hide_attr))), '[]'::jsonb) end);
  doc := jsonb_set(doc, '{columns,questions}', case when h_q then '[]'::jsonb else coalesce((
    select jsonb_agg(e) from jsonb_array_elements(doc->'columns'->'questions') as x(e)
     where not (e #>> '{}' = any(hide_q))), '[]'::jsonb) end);

  doc := jsonb_set(doc, '{targets}', coalesce((
    select jsonb_agg(
      t.el || jsonb_build_object(
        'services', case when h_svc then '[]'::jsonb else coalesce((
          select jsonb_agg(e) from jsonb_array_elements(t.el->'services') as y(e)
           where not (e->>'name' = any(hide_svc))), '[]'::jsonb) end,
        'amenities', case when h_amen then '[]'::jsonb else coalesce((
          select jsonb_agg(e) from jsonb_array_elements(t.el->'amenities') as y(e)
           where not (e->>'name' = any(hide_amen))), '[]'::jsonb) end,
        'attributes', case when h_attr then '[]'::jsonb else coalesce((
          select jsonb_agg(e) from jsonb_array_elements(t.el->'attributes') as y(e)
           where not (e->>'name' = any(hide_attr))), '[]'::jsonb) end,
        'answers', case when h_q then '[]'::jsonb else coalesce((
          select jsonb_agg(e) from jsonb_array_elements(t.el->'answers') as y(e)
           where not (e->>'prompt' = any(hide_q))), '[]'::jsonb) end,
        'tickets', case when h_tick then '[]'::jsonb else t.el->'tickets' end,
        -- A change naming something hidden would leak it back.
        'proposals', case when h_chg then '[]'::jsonb else coalesce((
          select jsonb_agg(e) from jsonb_array_elements(t.el->'proposals') as y(e)
           where not (h_gps and e->>'kind' = 'set_gps')
             and not (e->>'kind' = 'set_attribute' and (h_attr or coalesce(e->'payload'->>'attributeName', '') = any(hide_attr)))
             and not (e->>'kind' = 'set_service'   and (h_svc  or coalesce(e->'payload'->>'serviceName', '')   = any(hide_svc)))
             and not (e->>'kind' = 'set_amenity'   and (h_amen or coalesce(e->'payload'->>'amenityName', '')   = any(hide_amen)))), '[]'::jsonb) end,
        'finding', case when coalesce(t.el->'finding', 'null'::jsonb) = 'null'::jsonb then t.el->'finding' else
          (t.el->'finding')
            || case when h_marked then jsonb_build_object('clearlyMarked', null) else '{}'::jsonb end
            || case when h_map    then jsonb_build_object('mappedCorrectly', null) else '{}'::jsonb end
            || case when h_occ    then jsonb_build_object('occupied', null, 'unexpectedOccupancy', false) else '{}'::jsonb end
        end)
      order by t.ord)
      from jsonb_array_elements(doc->'targets') with ordinality as t(el, ord)
     where cardinality(keep) = 0 or (t.el->>'id')::uuid = any(keep)), '[]'::jsonb));

  if h_chg then doc := jsonb_set(doc, '{newLocationProposals}', '[]'::jsonb); end if;
  return doc;
end $$;

-- The public read, now filtered by whatever the link was made with.
create or replace function public.audit_report(p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh audit_shares%rowtype;
begin
  select * into sh from audit_shares where key = p_key;
  if sh.id is null or sh.revoked_at is not null or (sh.expires_at is not null and sh.expires_at < now()) then
    return null;
  end if;
  update audit_shares set view_count = view_count + 1, last_viewed_at = now() where id = sh.id;
  return public.filter_audit_report(public.audit_report_document(sh.audit_id), sh.filter);
end $$;

create function public.create_audit_share(p_audit uuid, p_label text, p_expires_at timestamptz, p_filter jsonb)
returns public.audit_shares
language plpgsql set search_path = public as $$
declare r audit_shares%rowtype;
begin
  insert into audit_shares (audit_id, label, created_by_id, expires_at, filter)
  values (p_audit, nullif(trim(p_label), ''), public.current_marina_user_id(), p_expires_at,
          coalesce(p_filter, '{}'::jsonb))
  returning * into r;
  return r;
end $$;

-- The three-argument form stays, and means "everything": a phone still on
-- the previous bundle keeps working.
create or replace function public.create_audit_share(p_audit uuid, p_label text, p_expires_at timestamptz)
returns public.audit_shares
language plpgsql set search_path = public as $$
begin
  return public.create_audit_share(p_audit, p_label, p_expires_at, '{}'::jsonb);
end $$;

revoke all on function public.filter_audit_report(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_audit_share(uuid, text, timestamptz, jsonb) from public, anon;
grant  execute on function public.create_audit_share(uuid, text, timestamptz, jsonb) to authenticated;

-- What the share form offers, which is exactly what this audit asked
-- about: the catalogue entries valid for its targets' types, its own
-- questions, and its targets with their areas. By id, because that is what
-- a filter stores. The report document carries names only, so the form
-- cannot be built from it.
create function public.audit_share_options(p_audit uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a audits%rowtype; type_ids uuid[];
begin
  if not public.has_permission('manage_audits') then
    raise exception 'manage_audits required' using errcode = 'insufficient_privilege';
  end if;
  select * into a from audits where id = p_audit;
  if a.id is null then return null; end if;
  select coalesce(array_agg(distinct l.location_type_id), '{}') into type_ids
    from audit_targets t join locations l on l.id = t.location_id where t.audit_id = p_audit;
  return jsonb_build_object(
    'kind', a.kind,
    'includeAttributes', a.include_attributes, 'includeServices', a.include_services,
    'includeAmenities', a.include_amenities, 'includeMarked', a.include_marked, 'includeMap', a.include_map,
    'services', case when a.kind = 'status' and a.include_services then coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.position, s.name) from services s
       where exists (select 1 from service_location_types v where v.service_id = s.id and v.location_type_id = any(type_ids))), '[]') else '[]' end,
    'amenities', case when a.kind = 'status' and a.include_amenities then coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.position, m.name) from amenities m
       where exists (select 1 from amenity_location_types v where v.amenity_id = m.id and v.location_type_id = any(type_ids))), '[]') else '[]' end,
    'attributes', case when a.kind = 'status' and a.include_attributes then coalesce((
      select jsonb_agg(jsonb_build_object('id', atr.id, 'name', atr.name) order by atr.position, atr.name) from attributes atr
       where exists (select 1 from attribute_location_types v where v.attribute_id = atr.id and v.location_type_id = any(type_ids))), '[]') else '[]' end,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt) order by q.position)
        from audit_questions q join audit_rules r on r.id = q.rule_id where r.audit_id = p_audit), '[]'),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.location_name, 'area', pl.name) order by t.position)
        from audit_targets t
        left join locations l on l.id = t.location_id
        left join locations pl on pl.id = l.parent_id
       where t.audit_id = p_audit), '[]'));
end $$;
revoke all on function public.audit_share_options(uuid) from public, anon;
grant  execute on function public.audit_share_options(uuid) to authenticated;
