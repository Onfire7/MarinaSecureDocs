-- Seeds the LOCAL database with a small open status audit for
-- scripts/e2e/audit-wizard.mjs. Never run against a marina's database.
-- Idempotent: drops its own audit and catalogue entries first.
do $$
declare
  me       uuid := (select id from users where active order by name limit 1);
  t_type   uuid;
  svc      uuid; amen uuid; attr uuid;
  a        uuid; rule uuid; q uuid;
  loc      record;
begin
  delete from audits where name = 'Wizard e2e';
  delete from services   where name = 'E2E Power';
  delete from amenities  where name = 'E2E WiFi';
  delete from attributes where name = 'E2E Length';

  -- The type the audit's locations have; any status-tracking one will do.
  select l.location_type_id into t_type
    from locations l join location_types ty on ty.id = l.location_type_id
   where ty.tracks_status and l.retired_at is null
   group by l.location_type_id order by count(*) desc limit 1;

  insert into services   (name, unit) values ('E2E Power', 'kWh') returning id into svc;
  insert into amenities  (name)       values ('E2E WiFi')        returning id into amen;
  insert into attributes (name, kind, unit) values ('E2E Length', 'number', 'ft') returning id into attr;
  insert into service_location_types   (service_id,   location_type_id) values (svc,  t_type);
  insert into amenity_location_types   (amenity_id,   location_type_id) values (amen, t_type);
  insert into attribute_location_types (attribute_id, location_type_id) values (attr, t_type);

  insert into audits (name, kind, launched_by_id, include_attributes, include_services, include_amenities, include_marked, include_map)
    values ('Wizard e2e', 'status', me, true, true, true, true, true)
    returning id into a;
  insert into audit_assignees (audit_id, user_id) values (a, me);
  insert into audit_rules (audit_id, position, mode, conditions) values (a, 0, 'all', '[]') returning id into rule;
  insert into audit_questions (rule_id, position, prompt, kind, ticket_on_no)
    values (rule, 0, 'Is the breaker labelled?', 'yes_no', true) returning id into q;

  -- Three targets, none audited, none with a pin.
  for loc in
    select id, name from locations
     where location_type_id = t_type and retired_at is null and gps_lat is null
     order by name limit 3
  loop
    insert into audit_targets (audit_id, location_id, location_name, position)
      values (a, loc.id, loc.name, (select count(*) from audit_targets where audit_id = a));
  end loop;
  insert into audit_target_questions (target_id, question_id, position)
    select t.id, q, 0 from audit_targets t where t.audit_id = a;
  raise notice 'audit %', a;
end $$;
select a.id, a.name, a.status, count(t.id) as targets
  from audits a join audit_targets t on t.audit_id = a.id
 where a.name = 'Wizard e2e' group by a.id, a.name, a.status;
