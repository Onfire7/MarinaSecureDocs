-- Filling a blank is not a decision.
--
-- An audit of 76 campsites produced 460 undecided Proposals, nearly all of
-- them a first value for a Location that had nothing on file. Approving
-- those decides nothing: no value is overwritten, nothing is lost, and the
-- "review" is a person ticking 460 boxes without reading them - which
-- trains exactly the habit that gets the REAL decisions rubber-stamped.
--
-- A Proposal should exist where there is something to decide. So a value
-- that fills a blank applies at once, and the Proposal recording it is born
-- approved and marked auto_applied. What still waits for a human is
-- unchanged: anything structural, GPS, a removal, and a change to a value
-- already on file. (That last case includes Attributes, which the spec's
-- "What becomes a Proposal" table never listed and the implementation had
-- been holding anyway.)
--
-- This hands an auditor without manage_audits the power to write a value
-- onto a Location, which is the point - but only where nothing is on file,
-- and the test for that is made here against real rows, not by the client.
-- The payload is the client's; the decision is not.

alter table audit_proposals add column auto_applied boolean not null default false;
comment on column audit_proposals.auto_applied is
  'Applied the moment it was recorded because nothing was on file. Born approved with no decided_by_id, and SKIPPED by finalize_audit - it is already applied, and re-applying would undo a hand correction made since.';

-- The three non-structural applications, in one place so finalize and the
-- auto-apply trigger cannot drift apart. Structural kinds stay inline in
-- finalize_audit, where they need its locals and its ordering.
create function public.apply_location_proposal(p_kind audit_proposal_kind, p_location uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_location is null then return; end if;
  case p_kind
    when 'set_service' then
      if (p_payload->>'present')::boolean then
        insert into location_services (location_id, service_id)
        values (p_location, (p_payload->>'service_id')::uuid) on conflict do nothing;
      else
        delete from location_services where location_id = p_location and service_id = (p_payload->>'service_id')::uuid;
      end if;
    when 'set_amenity' then
      if (p_payload->>'present')::boolean then
        insert into location_amenities (location_id, amenity_id)
        values (p_location, (p_payload->>'amenity_id')::uuid) on conflict do nothing;
      else
        delete from location_amenities where location_id = p_location and amenity_id = (p_payload->>'amenity_id')::uuid;
      end if;
    when 'set_attribute' then
      if jsonb_typeof(coalesce(p_payload->'value', 'null'::jsonb)) <> 'null'
         or jsonb_typeof(coalesce(p_payload->'text', 'null'::jsonb)) <> 'null' then
        insert into location_attributes (location_id, attribute_id, value, value_text, note)
        values (p_location, (p_payload->>'attribute_id')::uuid,
                (p_payload->>'value')::numeric, p_payload->>'text', p_payload->>'note')
        on conflict (location_id, attribute_id)
          do update set value = excluded.value, value_text = excluded.value_text, note = excluded.note;
      else
        delete from location_attributes where location_id = p_location and attribute_id = (p_payload->>'attribute_id')::uuid;
      end if;
    else
      null;
  end case;
end $$;

create function public.audit_proposal_autoapply() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  loc   uuid;
  entry uuid;
  blank boolean := false;
  ours  uuid;
begin
  -- Only the three value kinds, and only when nobody has decided already.
  if new.decision is not null or new.kind not in ('set_service','set_amenity','set_attribute') then
    return new;
  end if;
  select t.location_id into loc
    from audit_findings f join audit_targets t on t.id = f.target_id
   where f.id = new.finding_id;
  if loc is null then return new; end if;   -- a proposed new Location has nothing to write to yet

  case new.kind
    when 'set_service' then
      entry := (new.payload->>'service_id')::uuid;
      blank := coalesce((new.payload->>'present')::boolean, false)
               and not exists (select 1 from location_services where location_id = loc and service_id = entry);
    when 'set_amenity' then
      entry := (new.payload->>'amenity_id')::uuid;
      blank := coalesce((new.payload->>'present')::boolean, false)
               and not exists (select 1 from location_amenities where location_id = loc and amenity_id = entry);
    when 'set_attribute' then
      entry := (new.payload->>'attribute_id')::uuid;
      blank := not exists (select 1 from location_attributes
                            where location_id = loc and attribute_id = entry
                              and (value is not null or value_text is not null));
    else null;
  end case;

  -- ...or what is on file is this Finding's own auto-applied value, which
  -- this one supersedes. An audit may keep correcting itself without asking
  -- anybody; a Proposal a person decided is never superseded this way.
  select pr.id into ours from audit_proposals pr
   where pr.finding_id = new.finding_id and pr.kind = new.kind and pr.auto_applied
     and coalesce(pr.payload->>'service_id', pr.payload->>'amenity_id', pr.payload->>'attribute_id') = entry::text
   limit 1;

  if not blank and ours is null then return new; end if;

  if ours is not null then delete from audit_proposals where id = ours; end if;
  new.decision      := 'approved';
  new.decided_at    := now();
  new.decided_by_id := null;
  new.reason        := 'nothing was on file';
  new.auto_applied  := true;
  perform public.apply_location_proposal(new.kind, loc, new.payload);
  return new;
end $$;

-- After audit_proposal_set_structural, alphabetically, which is the order
-- Postgres fires them in and the order this needs.
create trigger audit_proposals_autoapply before insert on audit_proposals
  for each row execute function public.audit_proposal_autoapply();

revoke all on function public.apply_location_proposal(audit_proposal_kind, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_proposal_autoapply() from public, anon, authenticated;

-- finalize_audit, with two changes: it skips what the trigger already
-- applied, and the three value kinds now go through the shared function.
-- The body is otherwise 20260923000100's.
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
     -- auto_applied Proposals are already on the Location. Applying one a
     -- second time would overwrite whatever it holds NOW, silently undoing
     -- a correction somebody made between the audit and the finalize.
     where f.audit_id = p_audit and pr.decision = 'approved' and not pr.auto_applied
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
      -- Shared with the auto-apply trigger, so the two cannot drift.
      when 'set_service', 'set_amenity', 'set_attribute' then
        perform public.apply_location_proposal(p.kind, loc, p.payload);

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
end $function$
