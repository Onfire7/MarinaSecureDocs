-- Sharing an audit's results (docs/audits.md § Sharing the results).
--
-- The Audit Report is built ONCE, in the database, by build_audit_report():
-- the public page, the in-app page and the finalize snapshot all read the
-- same function, so they cannot drift. A Share Link is a row in
-- audit_shares whose random key is the whole credential; audit_report(key)
-- is the only thing an anonymous caller can reach and answers null alike
-- for a missing, revoked or expired key. Neither table syncs to devices:
-- a share key in a guard's SQLite would be a credential lying around, and
-- a finalized snapshot is a large document nobody needs offline.

-- ── tables ───────────────────────────────────────────────────────────────

create table public.audit_shares (
  id              uuid primary key default gen_random_uuid(),
  audit_id        uuid not null references public.audits(id) on delete cascade,
  key             uuid not null unique default gen_random_uuid(),
  label           text,
  created_by_id   uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz default now() + interval '90 days',
  revoked_at      timestamptz,
  view_count      integer not null default 0,
  last_viewed_at  timestamptz
);
create index audit_shares_audit_idx on public.audit_shares(audit_id);
comment on table public.audit_shares is
  'One row per Share Link to an Audit Report. key is the credential; expires_at null means never; revoked_at is set once.';

create table public.audit_report_snapshots (
  audit_id    uuid primary key references public.audits(id) on delete cascade,
  document    jsonb not null,
  created_at  timestamptz not null default now()
);
comment on table public.audit_report_snapshots is
  'The Audit Report as compiled at finalize. Served verbatim afterwards; never rebuilt.';

-- Only a closed or finalized audit has anything to report.
create function public.audit_share_guard() returns trigger
language plpgsql set search_path = public as $$
declare s audit_status;
begin
  select status into s from audits where id = new.audit_id;
  if s is distinct from 'closed' and s is distinct from 'finalized' then
    raise exception 'audit % is %, only a closed or finalized audit can be shared',
      new.audit_id, coalesce(s::text, 'missing') using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger audit_shares_guard before insert on public.audit_shares
  for each row execute function public.audit_share_guard();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Tier 1: manage_audits reads and writes shares. No policy for anon, and
-- no Tier 0 read: the key is a credential.
alter table public.audit_shares enable row level security;
create policy audit_shares_manage on public.audit_shares
  for all to authenticated
  using (public.has_permission('manage_audits'))
  with check (public.has_permission('manage_audits'));

-- Nobody reads snapshots directly; the report functions below do.
alter table public.audit_report_snapshots enable row level security;
revoke all on public.audit_report_snapshots from anon, authenticated;

-- ── the builder ──────────────────────────────────────────────────────────

-- One proposal for the document. Ids in the payload are resolved to names
-- here so the page never needs the catalogue; coordinates and placements
-- are dropped - a shared report carries no GPS.
create function public.audit_report_proposal(pr public.audit_proposals, p_by text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', pr.id,
    'kind', pr.kind,
    'structural', pr.structural,
    'decision', pr.decision,
    'reason', pr.reason,
    'recordedBy', p_by,
    'payload', (pr.payload - 'lat' - 'lng' - 'accuracy' - 'gps_lat' - 'gps_lng' - 'placement' - 'map_id')
      || jsonb_strip_nulls(jsonb_build_object(
           'serviceName',      (select name from services       where id = (pr.payload->>'service_id')::uuid),
           'amenityName',      (select name from amenities      where id = (pr.payload->>'amenity_id')::uuid),
           'attributeName',    (select name from attributes     where id = (pr.payload->>'attribute_id')::uuid),
           'attributeUnit',    (select unit from attributes     where id = (pr.payload->>'attribute_id')::uuid),
           'locationTypeName', (select name from location_types where id = (pr.payload->>'location_type_id')::uuid),
           'parentName',       (select name from locations      where id = (pr.payload->>'parent_id')::uuid))))
$$;

-- The whole document. Shape: AuditReport in src/lib/auditReport.ts.
create function public.build_audit_report(p_audit uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a         audits%rowtype;
  type_ids  uuid[];
  ask_svc   boolean;
  ask_amen  boolean;
  ask_attr  boolean;
  doc       jsonb;
begin
  select * into a from audits where id = p_audit;
  if a.id is null then return null; end if;
  select coalesce(array_agg(distinct l.location_type_id), '{}') into type_ids
    from audit_targets t join locations l on l.id = t.location_id
   where t.audit_id = p_audit;
  ask_svc  := a.kind = 'status' and a.include_services;
  ask_amen := a.kind = 'status' and a.include_amenities;
  ask_attr := a.kind = 'status' and a.include_attributes;

  select jsonb_build_object(
    'audit', jsonb_build_object(
      'id', a.id, 'name', a.name, 'kind', a.kind, 'status', a.status,
      'launchedAt', a.launched_at, 'closedAt', a.closed_at, 'finalizedAt', a.finalized_at,
      'includeAttributes', a.include_attributes, 'includeServices', a.include_services,
      'includeAmenities', a.include_amenities, 'includeMarked', a.include_marked, 'includeMap', a.include_map),
    'marinaName', coalesce((select marina_name from marina_settings limit 1), 'Marina'),
    'launchedBy',  (select name from users where id = a.launched_by_id),
    'closedBy',    (select name from users where id = a.closed_by_id),
    'finalizedBy', (select name from users where id = a.finalized_by_id),
    'assignees', coalesce((
      select jsonb_agg(coalesce(u.name, r.name) order by coalesce(u.name, r.name))
        from audit_assignees x
        left join users u on u.id = x.user_id
        left join roles r on r.id = x.role_id
       where x.audit_id = p_audit), '[]'),
    'columns', jsonb_build_object(
      'services', case when ask_svc then coalesce((
        select jsonb_agg(s.name order by s.position, s.name) from services s
         where exists (select 1 from service_location_types v where v.service_id = s.id and v.location_type_id = any(type_ids))), '[]') else '[]' end,
      'amenities', case when ask_amen then coalesce((
        select jsonb_agg(m.name order by m.position, m.name) from amenities m
         where exists (select 1 from amenity_location_types v where v.amenity_id = m.id and v.location_type_id = any(type_ids))), '[]') else '[]' end,
      'attributes', case when ask_attr then coalesce((
        select jsonb_agg(jsonb_build_object('name', atr.name, 'unit', atr.unit) order by atr.position, atr.name) from attributes atr
         where exists (select 1 from attribute_location_types v where v.attribute_id = atr.id and v.location_type_id = any(type_ids))), '[]') else '[]' end,
      'questions', coalesce((
        select jsonb_agg(q.prompt order by q.position) from audit_questions q
          join audit_rules r on r.id = q.rule_id where r.audit_id = p_audit), '[]')),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'locationId', t.location_id, 'name', t.location_name,
        'typeName', ty.name, 'area', pl.name,
        'state', t.state, 'notAuditedReason', t.not_audited_reason, 'displacedNote', t.displaced_note,
        'finding', case when f.id is null then null else jsonb_build_object(
          'recordedBy', u.name, 'recordedAt', f.recorded_at, 'occupied', f.occupied,
          'unexpectedOccupancy', f.unexpected_occupancy,
          'clearlyMarked', f.clearly_marked, 'mappedCorrectly', f.mapped_correctly) end,
        'services', case when ask_svc then coalesce((
          select jsonb_agg(jsonb_build_object('name', s.name, 'present', fs.present, 'working', fs.working, 'note', fs.note) order by s.position, s.name)
            from audit_finding_services fs join services s on s.id = fs.service_id where fs.finding_id = f.id), '[]') else '[]' end,
        'amenities', case when ask_amen then coalesce((
          select jsonb_agg(jsonb_build_object('name', m.name, 'present', fa.present, 'note', fa.note) order by m.position, m.name)
            from audit_finding_amenities fa join amenities m on m.id = fa.amenity_id where fa.finding_id = f.id), '[]') else '[]' end,
        'attributes', case when ask_attr and l.id is not null then coalesce((
          select jsonb_agg(jsonb_build_object(
                   'name', atr.name, 'unit', atr.unit,
                   'value', case when pp.id is not null then coalesce(pp.payload->>'text', pp.payload->>'value')
                                 else coalesce(la.value_text, la.value::text) end,
                   'proposed', pp.id is not null) order by atr.position, atr.name)
            from attributes atr
            join attribute_location_types v on v.attribute_id = atr.id and v.location_type_id = l.location_type_id
            left join location_attributes la on la.attribute_id = atr.id and la.location_id = l.id
            left join audit_proposals pp on pp.finding_id = f.id and pp.kind = 'set_attribute'
                                        and (pp.payload->>'attribute_id')::uuid = atr.id), '[]') else '[]' end,
        'answers', coalesce((
          select jsonb_agg(jsonb_build_object('prompt', q.prompt, 'kind', q.kind, 'value', an.value, 'ticketId', an.ticket_id) order by q.position)
            from audit_finding_answers an join audit_questions q on q.id = an.question_id where an.finding_id = f.id), '[]'),
        'proposals', coalesce((
          select jsonb_agg(public.audit_report_proposal(pr, u.name) order by pr.structural desc, pr.kind)
            from audit_proposals pr where pr.finding_id = f.id), '[]'),
        'tickets', coalesce((
          select jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'priority', k.priority,
                                              'status', ks.name, 'open', not coalesce(ks.is_terminal, false)) order by k.created_at)
            from tickets k left join ticket_statuses ks on ks.id = k.status_id where k.source_finding_id = f.id), '[]')
      ) order by t.position)
        from audit_targets t
        left join locations l on l.id = t.location_id
        left join location_types ty on ty.id = l.location_type_id
        left join locations pl on pl.id = l.parent_id
        left join audit_findings f on f.target_id = t.id
        left join users u on u.id = f.recorded_by_id
       where t.audit_id = p_audit), '[]'),
    'newLocationProposals', coalesce((
      select jsonb_agg(public.audit_report_proposal(pr, u.name) order by pr.kind)
        from audit_proposals pr
        join audit_findings f on f.id = pr.finding_id
        left join users u on u.id = f.recorded_by_id
       where f.audit_id = p_audit and f.target_id is null), '[]'),
    'asOf', clock_timestamp())
  into doc;
  return doc;
end $$;

-- Live while closed, the stored snapshot once finalized. An audit finalized
-- before this migration has no snapshot; the first read makes one, so
-- "never changes after finalize" holds from that moment on.
create function public.audit_report_document(p_audit uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a   audits%rowtype;
  doc jsonb;
begin
  select * into a from audits where id = p_audit;
  if a.id is null then return null; end if;
  if a.status = 'finalized' then
    select document into doc from audit_report_snapshots where audit_id = p_audit;
    if doc is null then
      doc := public.build_audit_report(p_audit);
      insert into audit_report_snapshots (audit_id, document) values (p_audit, doc)
        on conflict (audit_id) do update set document = excluded.document;
    end if;
    return doc;
  end if;
  return public.build_audit_report(p_audit);
end $$;

-- ── what callers reach ───────────────────────────────────────────────────

-- The public page. Missing, revoked and expired keys are one null.
create function public.audit_report(p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh audit_shares%rowtype;
begin
  select * into sh from audit_shares where key = p_key;
  if sh.id is null or sh.revoked_at is not null or (sh.expires_at is not null and sh.expires_at < now()) then
    return null;
  end if;
  update audit_shares set view_count = view_count + 1, last_viewed_at = now() where id = sh.id;
  return public.audit_report_document(sh.audit_id);
end $$;

-- The in-app page: any active marina user (Tier 0, as the audits table).
create function public.audit_report_for(p_audit uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.current_marina_user_id() is null then
    raise exception 'not a marina user' using errcode = 'insufficient_privilege';
  end if;
  return public.audit_report_document(p_audit);
end $$;

-- Under RLS: manage_audits, and the guard above. Null expiry means never.
create function public.create_audit_share(p_audit uuid, p_label text, p_expires_at timestamptz) returns public.audit_shares
language plpgsql set search_path = public as $$
declare r audit_shares%rowtype;
begin
  insert into audit_shares (audit_id, label, created_by_id, expires_at)
  values (p_audit, nullif(trim(p_label), ''), public.current_marina_user_id(), p_expires_at)
  returning * into r;
  return r;
end $$;

create function public.revoke_audit_share(p_share uuid) returns void
language plpgsql set search_path = public as $$
declare n integer;
begin
  update audit_shares set revoked_at = coalesce(revoked_at, now()) where id = p_share;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no such share' using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke all on function public.audit_report_proposal(public.audit_proposals, text) from public, anon, authenticated;
revoke all on function public.build_audit_report(uuid)    from public, anon, authenticated;
revoke all on function public.audit_report_document(uuid) from public, anon, authenticated;
revoke all on function public.audit_report(uuid)          from public;
grant  execute on function public.audit_report(uuid)      to anon, authenticated;
revoke all on function public.audit_report_for(uuid)      from public, anon;
grant  execute on function public.audit_report_for(uuid)  to authenticated;
revoke all on function public.create_audit_share(uuid, text, timestamptz) from public, anon;
grant  execute on function public.create_audit_share(uuid, text, timestamptz) to authenticated;
revoke all on function public.revoke_audit_share(uuid)    from public, anon;
grant  execute on function public.revoke_audit_share(uuid) to authenticated;

-- ── finalize stores the snapshot ─────────────────────────────────────────
-- The body is 20260922001000's, plus the snapshot after the status flips
-- so the stored document says "finalized".
CREATE OR REPLACE FUNCTION public.finalize_audit(p_audit uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a        audits%rowtype;
  me       uuid := public.current_marina_user_id();
  p        record;
  loc      uuid;
  new_loc  uuid;
  history  integer;
  svc      uuid;
  amen     uuid;
begin
  if not public.has_permission('manage_audits') then
    raise exception 'manage_audits required' using errcode = 'insufficient_privilege';
  end if;
  select * into a from audits where id = p_audit for update;
  if a.id is null then raise exception 'no such audit'; end if;
  if a.status <> 'closed' then
    raise exception 'audit is %, only a closed audit can be finalized', a.status
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from audit_proposals pr join audit_findings f on f.id = pr.finding_id
              where f.audit_id = p_audit and pr.decision is null) then
    raise exception 'every proposal needs a decision before finalizing'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from audit_proposals pr join audit_findings f on f.id = pr.finding_id
              where f.audit_id = p_audit and pr.decision = 'approved' and pr.structural)
     and not public.has_permission('manage_locations') then
    raise exception 'manage_locations required to apply structural proposals'
      using errcode = 'insufficient_privilege';
  end if;

  -- Creates first so tickets can re-target, retirements last so nothing else
  -- in the same audit refers to a location that has just gone.
  for p in
    select pr.*, f.target_id, t.location_id as target_location_id, f.id as fid
      from audit_proposals pr
      join audit_findings f on f.id = pr.finding_id
      left join audit_targets t on t.id = f.target_id
     where f.audit_id = p_audit and pr.decision = 'approved'
     order by case pr.kind when 'create_location' then 0 when 'retire_location' then 2 else 1 end, pr.decided_at
  loop
    loc := coalesce((p.payload->>'location_id')::uuid, p.target_location_id);
    case p.kind
      when 'create_location' then
        insert into locations (name, location_type_id, parent_id, gps_lat, gps_lng, status_id)
        values (p.payload->>'name', (p.payload->>'location_type_id')::uuid,
                (p.payload->>'parent_id')::uuid,
                (p.payload->>'gps_lat')::double precision, (p.payload->>'gps_lng')::double precision,
                (p.payload->>'status_id')::uuid)
        returning id into new_loc;
        for svc in select (x)::uuid from jsonb_array_elements_text(coalesce(p.payload->'services','[]')) x loop
          insert into location_services (location_id, service_id) values (new_loc, svc) on conflict do nothing;
        end loop;
        for amen in select (x)::uuid from jsonb_array_elements_text(coalesce(p.payload->'amenities','[]')) x loop
          insert into location_amenities (location_id, amenity_id) values (new_loc, amen) on conflict do nothing;
        end loop;
        update audit_proposals set applied_location_id = new_loc where id = p.id;
        update tickets set location_id = new_loc where proposal_id = p.id;
        insert into activity_log_entries (event_type, summary, subject_type, subject_id, actor_id)
        values ('location.created', format('%s created by audit "%s"', p.payload->>'name', a.name), 'locations', new_loc, me);

      when 'rename' then
        update locations set name = p.payload->>'name' where id = loc;
      when 'retype' then
        update locations set location_type_id = (p.payload->>'location_type_id')::uuid where id = loc;
      when 'reparent' then
        update locations set parent_id = (p.payload->>'parent_id')::uuid where id = loc;
      when 'move_placement' then
        insert into location_map_placements (map_id, location_id, placement)
        values ((p.payload->>'map_id')::uuid, loc, p.payload->'placement')
        on conflict (map_id, location_id) do update set placement = excluded.placement;
      when 'set_gps' then
        update locations set gps_lat = (p.payload->>'lat')::double precision,
                             gps_lng = (p.payload->>'lng')::double precision
         where id = loc;
      when 'set_service' then
        if (p.payload->>'present')::boolean then
          insert into location_services (location_id, service_id)
          values (loc, (p.payload->>'service_id')::uuid) on conflict do nothing;
        else
          delete from location_services where location_id = loc and service_id = (p.payload->>'service_id')::uuid;
        end if;
      when 'set_amenity' then
        if (p.payload->>'present')::boolean then
          insert into location_amenities (location_id, amenity_id)
          values (loc, (p.payload->>'amenity_id')::uuid) on conflict do nothing;
        else
          delete from location_amenities where location_id = loc and amenity_id = (p.payload->>'amenity_id')::uuid;
        end if;
      when 'set_attribute' then
        if jsonb_typeof(coalesce(p.payload->'value', 'null'::jsonb)) <> 'null'
           or jsonb_typeof(coalesce(p.payload->'text', 'null'::jsonb)) <> 'null' then
          insert into location_attributes (location_id, attribute_id, value, value_text, note)
          values (loc, (p.payload->>'attribute_id')::uuid,
                  (p.payload->>'value')::numeric, p.payload->>'text', p.payload->>'note')
          on conflict (location_id, attribute_id)
            do update set value = excluded.value, value_text = excluded.value_text, note = excluded.note;
        else
          delete from location_attributes where location_id = loc and attribute_id = (p.payload->>'attribute_id')::uuid;
        end if;

      when 'retire_location' then
        update audit_targets t set state = 'not_audited',
               not_audited_reason = format('retired by Audit "%s"', a.name)
          from audits o
         where t.audit_id = o.id and o.status = 'open' and o.id <> p_audit
           and t.location_id = loc and t.state = 'pending';
        select (select count(*) from tickets      where location_id = loc)
             + (select count(*) from notes        where location_id = loc)
             + (select count(*) from incidents    where location_id = loc)
             + (select count(*) from leases       where location_id = loc)
             + (select count(*) from reservations where location_id = loc)
             + (select count(*) from checkpoints  where location_id = loc)
             + (select count(*) from locations    where parent_id = loc)
             + (select count(*) from boats        where location_id = loc)
             + (select count(*) from vehicles     where location_id = loc)
             + (select count(*) from audit_targets t2
                 where t2.location_id = loc and t2.audit_id <> p_audit
                   and exists (select 1 from audit_findings f2 where f2.target_id = t2.id))
          into history;
        if history = 0 then
          delete from location_map_placements where location_id = loc;
          delete from location_services where location_id = loc;
          delete from location_amenities where location_id = loc;
          delete from location_attributes where location_id = loc;
          delete from locations where id = loc;
          insert into activity_log_entries (event_type, summary, subject_type, subject_id, actor_id)
          values ('location.deleted', format('deleted by audit "%s": no history', a.name), 'locations', loc, me);
        else
          update locations set retired_at = now() where id = loc;
          insert into activity_log_entries (event_type, summary, subject_type, subject_id, actor_id)
          values ('location.retired', format('retired by audit "%s"', a.name), 'locations', loc, me);
        end if;
    end case;

    if p.kind not in ('create_location','retire_location') then
      insert into activity_log_entries (event_type, summary, subject_type, subject_id, actor_id)
      values ('location.updated', format('%s applied from audit "%s"', p.kind, a.name), 'locations', loc, me);
    end if;
  end loop;

  if a.kind = 'occupancy' then
    update locations l set last_occupancy_audit_at = now()
      from audit_targets t join audit_findings f on f.target_id = t.id
     where t.audit_id = p_audit and l.id = t.location_id;
  else
    update locations l set last_status_audit_at = now()
      from audit_targets t join audit_findings f on f.target_id = t.id
     where t.audit_id = p_audit and l.id = t.location_id;
  end if;

  update audits set status = 'finalized', finalized_at = now(), finalized_by_id = me where id = p_audit;

  -- The report a Finalized audit will show forever, built with the status
  -- already flipped so the document says so.
  insert into audit_report_snapshots (audit_id, document)
  values (p_audit, public.build_audit_report(p_audit))
  on conflict (audit_id) do update set document = excluded.document, created_at = now();
end $function$;
