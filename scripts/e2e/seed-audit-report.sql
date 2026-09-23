-- Seeds the LOCAL database with a realistic closed status audit and a
-- finalized occupancy audit for scripts/e2e/audit-report.mjs (and for
-- looking at the report by hand). Never run against a marina's database.
-- Idempotent: drops its own audits (by name) before inserting.
do $$
declare
  me        uuid := (select id from users where active order by name limit 1);
  t_slip    uuid := (select id from location_types where name = 'Slip');
  t_camp    uuid := (select id from location_types where name = 'Campsite');
  s_power   uuid; s_water uuid; s_sewer uuid;
  a_fire    uuid; a_table uuid; a_wifi uuid;
  at_len    uuid := (select id from attributes where name = 'Max boat length');
  at_site   uuid := (select id from attributes where name = 'Access');
  st_open   uuid := (select id from ticket_statuses where name = 'Open');
  audit1    uuid; audit2 uuid; rule1 uuid; rule2 uuid; q1 uuid; q2 uuid; q3 uuid;
  tgt       record; f uuid; n int := 0; nowts timestamptz := now() - interval '3 days';
  dock_map  uuid := (select id from marina_maps order by name limit 1);
begin
  delete from audits where name in ('Campground & B Dock status - Sept 2026', 'B Dock occupancy - Sept 2026');

  -- Local catalogue: enough to make a status audit interesting.
  insert into services (name, unit) select 'Water', 'gal' where not exists (select 1 from services where name='Water');
  insert into services (name, unit) select 'Sewer', null where not exists (select 1 from services where name='Sewer');
  insert into amenities (name) select 'Fire pit' where not exists (select 1 from amenities where name='Fire pit');
  insert into amenities (name) select 'Picnic table' where not exists (select 1 from amenities where name='Picnic table');
  insert into amenities (name) select 'WiFi' where not exists (select 1 from amenities where name='WiFi');
  select id into s_power from services where name like 'Shore power%' limit 1;
  select id into s_water from services where name='Water';
  select id into s_sewer from services where name='Sewer';
  select id into a_fire from amenities where name='Fire pit';
  select id into a_table from amenities where name='Picnic table';
  select id into a_wifi from amenities where name='WiFi';
  insert into service_location_types (service_id, location_type_id)
    select s, t from (values (s_power, t_camp), (s_water, t_camp), (s_sewer, t_camp), (s_water, t_slip)) v(s, t)
    where not exists (select 1 from service_location_types x where x.service_id = v.s and x.location_type_id = v.t);
  insert into amenity_location_types (amenity_id, location_type_id)
    select a, t from (values (a_fire, t_camp), (a_table, t_camp), (a_wifi, t_camp), (a_wifi, t_slip)) v(a, t)
    where not exists (select 1 from amenity_location_types x where x.amenity_id = v.a and x.location_type_id = v.t);
  insert into attribute_location_types (attribute_id, location_type_id)
    select a, t from (values (at_site, t_camp), (at_len, t_slip)) v(a, t)
    where not exists (select 1 from attribute_location_types x where x.attribute_id = v.a and x.location_type_id = v.t);

  -- ── Audit 1: status, closed, mostly decided ──────────────────────────────
  insert into audits (name, kind, status, launched_by_id, launched_at, include_attributes, include_services, include_amenities, include_marked, include_map)
    values ('Campground & B Dock status - Sept 2026', 'status', 'open', me, nowts, true, true, true, true, true)
    returning id into audit1;
  insert into audit_assignees (audit_id, user_id) values (audit1, me);
  insert into audit_rules (audit_id, position, mode, conditions) values (audit1, 0, 'all', '[]') returning id into rule1;
  insert into audit_questions (rule_id, position, prompt, kind, ticket_on_no) values (rule1, 0, 'Is the pedestal breaker labelled?', 'yes_no', true) returning id into q1;
  insert into audit_questions (rule_id, position, prompt, kind, choices) values (rule1, 1, 'Fire ring condition', 'choice', array['Good','Rusted','Missing']) returning id into q2;

  insert into audit_targets (audit_id, location_id, location_name, position)
    select audit1, l.id, l.name, row_number() over (order by l.name)
      from (
        (select id, name from locations where location_type_id = t_camp and retired_at is null order by name limit 30)
        union all
        (select id, name from locations where location_type_id = t_slip and retired_at is null and name ilike 'bh14%' order by name limit 20)
      ) l;
  insert into audit_target_questions (target_id, question_id, position)
    select t.id, q1, 0 from audit_targets t where t.audit_id = audit1;
  insert into audit_target_questions (target_id, question_id, position)
    select t.id, q2, 1 from audit_targets t join locations l on l.id = t.location_id where t.audit_id = audit1 and l.location_type_id = t_camp;

  for tgt in select t.id, t.location_id, t.location_name, t.position, l.location_type_id as type_id
               from audit_targets t join locations l on l.id = t.location_id
              where t.audit_id = audit1 order by t.position loop
    n := n + 1;
    -- 38 of 50 audited; the rest are left for "closed early".
    continue when tgt.position in (7, 13, 19, 22, 28, 31, 36, 41, 44, 47, 49, 50);
    insert into audit_findings (audit_id, target_id, recorded_by_id, recorded_at, clearly_marked, mapped_correctly)
      values (audit1, tgt.id, me, nowts + (tgt.position || ' hours')::interval,
              case when tgt.position % 9 = 0 then false when tgt.position % 11 = 0 then null else true end,
              case when tgt.position % 8 = 0 then false when tgt.position % 13 = 0 then null else true end)
      returning id into f;
    if tgt.type_id = t_camp then
      insert into audit_finding_services (finding_id, service_id, present, working, note) values
        (f, s_power, true,  tgt.position % 7 <> 0, case when tgt.position % 7 = 0 then 'breaker trips under load' else null end),
        (f, s_water, tgt.position % 5 <> 0, true, null),
        (f, s_sewer, tgt.position % 3 = 0, tgt.position % 6 <> 0, case when tgt.position % 6 = 0 then 'cap missing' else null end);
      insert into audit_finding_amenities (finding_id, amenity_id, present, note) values
        (f, a_fire,  tgt.position % 4 <> 0, null),
        (f, a_table, true, null),
        (f, a_wifi,  tgt.position % 2 = 0, case when tgt.position % 10 = 0 then 'weak signal' else null end);
      insert into audit_finding_answers (finding_id, question_id, value) values
        (f, q1, to_jsonb(tgt.position % 5 <> 0)),
        (f, q2, to_jsonb(case when tgt.position % 4 = 0 then 'Rusted' when tgt.position % 15 = 0 then 'Missing' else 'Good' end));
      if tgt.position % 6 = 0 then
        insert into audit_proposals (finding_id, kind, structural, payload, decision, decided_by_id, decided_at)
          values (f, 'set_attribute', false, jsonb_build_object('attribute_id', at_site, 'value', null, 'text', case when tgt.position % 12 = 0 then 'Pull-through' else 'Back-in' end, 'note', null), 'approved', me, now());
      end if;
    else
      insert into audit_finding_services (finding_id, service_id, present, working, note) values
        (f, s_power, true, tgt.position % 10 <> 0, case when tgt.position % 10 = 0 then 'pedestal dead' else null end),
        (f, s_water, tgt.position % 4 <> 0, true, null);
      insert into audit_finding_amenities (finding_id, amenity_id, present, note) values (f, a_wifi, true, null);
      insert into audit_finding_answers (finding_id, question_id, value) values (f, q1, to_jsonb(tgt.position % 7 <> 0));
      if tgt.position % 5 = 0 then
        insert into audit_proposals (finding_id, kind, structural, payload, decision, decided_by_id, decided_at, reason)
          values (f, 'set_attribute', false, jsonb_build_object('attribute_id', at_len, 'value', 30 + tgt.position % 12, 'text', null, 'note', null),
                  (case when tgt.position % 10 = 0 then 'rejected' else 'approved' end)::audit_decision, me, now(), case when tgt.position % 10 = 0 then 'Measured wrong side of the finger' else null end);
      end if;
    end if;
    -- Presence changes vs. what's on file (nothing on file locally, so every "present" is a proposal).
    if tgt.position % 5 <> 0 then
      insert into audit_proposals (finding_id, kind, structural, payload, decision, decided_by_id, decided_at)
        values (f, 'set_service', false, jsonb_build_object('service_id', s_water, 'present', true), 'approved', me, now());
    end if;
    if tgt.position % 8 = 0 then
      insert into audit_proposals (finding_id, kind, structural, payload, decision)
        values (f, 'move_placement', true, jsonb_build_object('map_id', dock_map, 'placement', jsonb_build_object('cx', 40 + tgt.position, 'cy', 55, 'rotation', 0)), null);
    end if;
    if tgt.position % 17 = 0 then
      insert into audit_proposals (finding_id, kind, structural, payload, decision, decided_by_id, decided_at)
        values (f, 'set_gps', false, jsonb_build_object('lat', 33.8 + tgt.position / 10000.0, 'lng', -96.6, 'accuracy', 6), 'approved', me, now());
    end if;
    if tgt.position = 23 then
      insert into audit_proposals (finding_id, kind, structural, payload, decision, decided_by_id, decided_at)
        values (f, 'rename', true, jsonb_build_object('name', tgt.location_name || 'A'), 'approved', me, now());
    end if;
    if tgt.position = 37 then
      insert into audit_proposals (finding_id, kind, structural, payload, decision, decided_by_id, decided_at, reason)
        values (f, 'retire_location', true, '{}', 'rejected', me, now(), 'Still leased through October');
    end if;
    -- Tickets from ticket-on-No answers and dead pedestals.
    if tgt.position % 5 = 0 or tgt.position % 10 = 0 then
      insert into tickets (title, description, priority, status_id, auto_generated, created_at, created_by_id, location_id, source_finding_id)
        values ('Label pedestal breaker at ' || tgt.location_name, 'Raised by audit: Is the pedestal breaker labelled? - No', 'medium', st_open, true, nowts + (tgt.position || ' hours')::interval, me, tgt.location_id, f);
    end if;
    if tgt.position % 7 = 0 and tgt.type_id = t_camp then
      insert into tickets (title, description, priority, status_id, auto_generated, created_at, created_by_id, location_id, source_finding_id)
        values ('Shore power breaker trips under load - ' || tgt.location_name, 'Found during status audit', 'high', st_open, false, nowts + (tgt.position || ' hours')::interval, me, tgt.location_id, f);
    end if;
  end loop;
  update audit_targets t set state = 'audited' where t.audit_id = audit1 and exists (select 1 from audit_findings f where f.target_id = t.id);
  update audit_targets t set state = 'not_audited', not_audited_reason = 'closed early' where t.audit_id = audit1 and state = 'pending';
  update audits set status = 'closed', closed_by_id = me, closed_at = nowts + interval '2 days' where id = audit1;

  -- ── Audit 2: occupancy, finalized, with unexpected occupancy ────────────
  insert into audits (name, kind, status, launched_by_id, launched_at, include_attributes, include_services, include_amenities, include_marked, include_map)
    values ('B Dock occupancy - Sept 2026', 'occupancy', 'open', me, nowts - interval '10 days', true, true, true, true, true)
    returning id into audit2;
  insert into audit_assignees (audit_id, user_id) values (audit2, me);
  insert into audit_rules (audit_id, position, mode, conditions) values (audit2, 0, 'all', '[]') returning id into rule2;
  insert into audit_questions (rule_id, position, prompt, kind) values (rule2, 0, 'Dock lines in good condition?', 'yes_no') returning id into q3;
  insert into audit_targets (audit_id, location_id, location_name, position)
    select audit2, l.id, l.name, row_number() over (order by l.name)
      from (select id, name from locations where location_type_id = t_slip and retired_at is null and name ilike 'bh04%' order by name limit 24) l;
  insert into audit_target_questions (target_id, question_id, position) select t.id, q3, 0 from audit_targets t where t.audit_id = audit2;
  for tgt in select t.id, t.location_id, t.position from audit_targets t where t.audit_id = audit2 order by t.position loop
    continue when tgt.position in (5, 14);
    insert into audit_findings (audit_id, target_id, recorded_by_id, recorded_at, occupied, unexpected_occupancy)
      values (audit2, tgt.id, me, nowts - interval '9 days' + (tgt.position || ' hours')::interval, tgt.position % 3 <> 0, tgt.position % 8 = 0)
      returning id into f;
    insert into audit_finding_answers (finding_id, question_id, value) values (f, q3, to_jsonb(tgt.position % 6 <> 0));
  end loop;
  update audit_targets t set state = 'audited' where t.audit_id = audit2 and exists (select 1 from audit_findings f where f.target_id = t.id);
  update audit_targets t set state = 'not_audited', not_audited_reason = 'closed early' where t.audit_id = audit2 and state = 'pending';
  update audits set status = 'closed', closed_by_id = me, closed_at = nowts - interval '8 days' where id = audit2;
  update audits set status = 'finalized', finalized_by_id = me, finalized_at = nowts - interval '7 days' where id = audit2;
  raise notice 'audit1 % audit2 %', audit1, audit2;
end $$;
select id, name, status, (select count(*) from audit_targets t where t.audit_id = a.id) as targets,
       (select count(*) from audit_findings f where f.audit_id = a.id) as findings
  from audits a where name like '%Sept 2026' order by name;
