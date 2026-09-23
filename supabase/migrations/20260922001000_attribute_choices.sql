-- An Attribute can be a choice, not only a number.
--
-- "Maximum boat length: 35 ft" and "Site type: back-in or pull-through" are
-- the same kind of fact about a Location — what it will accept — and the
-- marina defines both the same way. So an Attribute now declares a `kind`:
-- a `number` (with its unit) or a `choice` (with its options), the same
-- option list an Audit Question's Choice kind already uses.
--
-- A Location's value lands in `value` for a number and `value_text` for a
-- choice; exactly one, enforced here rather than trusted to the client.
-- `value` loses its not-null: row presence still means "a value is set",
-- and which column holds it follows the Attribute's kind.

create type attribute_kind as enum ('number', 'choice');

alter table attributes
  add column kind    attribute_kind not null default 'number',
  add column choices text[] not null default '{}';

alter table location_attributes
  alter column value drop not null,
  add column value_text text,
  add constraint location_attributes_one_value check (num_nonnulls(value, value_text) = 1);

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
        -- Always applied here, never straight from a Finding: what a
        -- Location will accept is worth a second look, unlike a service's
        -- working flag. An Attribute is always applicable to a valid type —
        -- there is no presence to decide, only whether it has a value. A
        -- number Attribute fills `value`, a choice one `value_text`; both
        -- null means the auditor cleared it.
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
        -- Every other open audit that still expected a finding here.
        update audit_targets t set state = 'not_audited',
               not_audited_reason = format('retired by Audit "%s"', a.name)
          from audits o
         where t.audit_id = o.id and o.status = 'open' and o.id <> p_audit
           and t.location_id = loc and t.state = 'pending';
        -- No history at all means created in error: delete. Otherwise retire.
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

  -- Stamp every location this audit actually looked at.
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
end $function$

;
