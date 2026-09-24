-- Which Locations have since been removed (docs/audits.md § 6).
--
-- An approved retirement takes a Location out of the marina, and a report
-- that lists it as though it were still there is telling a reader to go
-- and look at something that is gone. The row stays - the reading it
-- carries is history worth keeping, and the totals do not move, because
-- the Location was audited whatever became of it - but it is struck
-- through and says so.
--
-- The document carries the date rather than a flag, so the page can tell
-- "this Audit retired it" (its own approved retire_location Proposal is
-- right there in the row) from "somebody retired it since".
--
-- The body is 20260923000100's, plus retiredAt on each target.

CREATE OR REPLACE FUNCTION public.build_audit_report(p_audit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- What became of the Location afterwards. Frozen into the
        -- snapshot at finalize like everything else here, so a report
        -- does not start striking rows out years later.
        'retiredAt', l.retired_at,
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
end $function$
