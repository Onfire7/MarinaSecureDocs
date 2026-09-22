-- Location Audits.
--
-- docs/audits.md is the behavioural spec; docs/data-model.md § Audits the
-- table reference; CONTEXT.md the vocabulary. In one paragraph: a user with
-- manage_audits launches an Audit from a Template whose rule tree resolves,
-- at launch, into a fixed list of target locations. Assignees record one
-- Finding per target. Cheap, self-correcting facts (status, occupants,
-- tickets) apply at once through the ordinary tables; structural or
-- error-prone ones (new and retired locations, GPS, service presence) are
-- Proposals that wait for a desk decision. finalize_audit() applies the
-- approved ones.
--
-- Three invariants live here rather than in the client, because an upload
-- from a phone that was offline for a night must meet them too:
--   * a Finding cannot land on a Closed or Finalized audit          (trigger)
--   * only a Finding's author edits it, and only while the audit is Open (RLS)
--   * a structural Proposal is decided only by manage_locations      (RLS)
-- and finalize_audit() is the single path that changes marina structure
-- from an audit, so the checks are in one place.

create type audit_kind          as enum ('occupancy', 'status');
create type audit_question_kind as enum ('yes_no', 'choice', 'text', 'meter_reading');
create type audit_status        as enum ('open', 'closed', 'finalized');
create type audit_target_state  as enum ('pending', 'audited', 'not_audited');
create type audit_proposal_kind as enum ('create_location','retire_location','rename','retype',
                                         'reparent','move_placement','set_gps','set_service','set_amenity');
create type audit_decision      as enum ('approved', 'rejected');

-- ── templates ─────────────────────────────────────────────────────────────

create table audit_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          audit_kind not null,
  created_by_id uuid references users(id),
  created_at    timestamptz not null default now()
);

create table audits (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  kind            audit_kind not null,
  template_id     uuid references audit_templates(id) on delete set null,
  status          audit_status not null default 'open',
  launched_by_id  uuid references users(id),
  launched_at     timestamptz not null default now(),
  closed_by_id    uuid references users(id),
  closed_at       timestamptz,
  finalized_by_id uuid references users(id),
  finalized_at    timestamptz,
  -- Sync scope: in scope while not finalized, and for 30 days after.
  is_current      boolean not null default true
);
create index audits_status_idx on audits (status);
create index audits_current_idx on audits (id) where is_current;

-- A rule belongs to a template OR to an audit: launch copies the tree onto
-- the audit so later template edits never reach it.
create table audit_rules (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid references audit_templates(id) on delete cascade,
  audit_id       uuid references audits(id) on delete cascade,
  parent_rule_id uuid references audit_rules(id) on delete cascade,
  position       integer not null default 0,
  -- all = every condition must hold, any = one is enough.
  mode           text not null default 'all' check (mode in ('all','any')),
  -- [{subject, verb, value}] — see src/lib/auditRules.ts. Evaluated on the
  -- client at launch; a STRUCTURED_COLUMNS entry.
  conditions     jsonb not null default '[]',
  constraint audit_rules_one_owner check (num_nonnulls(template_id, audit_id) = 1)
);
create index audit_rules_template_idx on audit_rules (template_id);
create index audit_rules_audit_idx    on audit_rules (audit_id);
create index audit_rules_parent_idx   on audit_rules (parent_rule_id);

create table audit_questions (
  id           uuid primary key default gen_random_uuid(),
  rule_id      uuid not null references audit_rules(id) on delete cascade,
  position     integer not null default 0,
  prompt       text not null,
  kind         audit_question_kind not null default 'yes_no',
  choices      text[],
  ticket_on_no boolean not null default false,
  -- meter_reading only: which metered service to read.
  service_id   uuid references services(id) on delete set null
);
create index audit_questions_rule_idx on audit_questions (rule_id);

-- ── an audit's working set ────────────────────────────────────────────────

create table audit_assignees (
  id         uuid primary key default gen_random_uuid(),
  audit_id   uuid not null references audits(id) on delete cascade,
  user_id    uuid references users(id) on delete cascade,
  role_id    uuid references roles(id) on delete cascade,
  is_current boolean not null default true,
  constraint audit_assignees_one_of check (num_nonnulls(user_id, role_id) = 1)
);
create index audit_assignees_audit_idx on audit_assignees (audit_id);

create table audit_targets (
  id                 uuid primary key default gen_random_uuid(),
  audit_id           uuid not null references audits(id) on delete cascade,
  -- SET NULL, not cascade: a location deleted at finalize (no history) still
  -- leaves the target and its finding as the record of what was found. The
  -- name is snapshotted for the same reason.
  location_id        uuid references locations(id) on delete set null,
  location_name      text not null,
  position           integer not null default 0,
  state              audit_target_state not null default 'pending',
  not_audited_reason text,
  is_current         boolean not null default true,
  unique (audit_id, location_id)
);
create index audit_targets_audit_idx    on audit_targets (audit_id, position);
create index audit_targets_location_idx on audit_targets (location_id);

create table audit_findings (
  id                   uuid primary key default gen_random_uuid(),
  audit_id             uuid not null references audits(id) on delete cascade,
  -- Null only for a proposed new location, whose details live in its
  -- create_location proposal.
  target_id            uuid unique references audit_targets(id) on delete cascade,
  recorded_by_id       uuid not null references users(id),
  recorded_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  occupied             boolean,
  contact_id           uuid references contacts(id) on delete set null,
  unexpected_occupancy boolean not null default false,
  clearly_marked       boolean,
  mapped_correctly     boolean,
  -- "expected <boat>, found elsewhere", written by another finding in the
  -- same audit that moved the occupant.
  displaced_note       text,
  is_current           boolean not null default true
);
create index audit_findings_audit_idx on audit_findings (audit_id);

create table audit_finding_boats (
  id         uuid primary key default gen_random_uuid(),
  finding_id uuid not null references audit_findings(id) on delete cascade,
  boat_id    uuid not null references boats(id) on delete cascade,
  is_current boolean not null default true,
  unique (finding_id, boat_id)
);
create table audit_finding_vehicles (
  id         uuid primary key default gen_random_uuid(),
  finding_id uuid not null references audit_findings(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  is_current boolean not null default true,
  unique (finding_id, vehicle_id)
);
create table audit_finding_services (
  id         uuid primary key default gen_random_uuid(),
  finding_id uuid not null references audit_findings(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  present    boolean not null,
  working    boolean not null default true,
  note       text,
  is_current boolean not null default true,
  unique (finding_id, service_id)
);
create table audit_finding_amenities (
  id         uuid primary key default gen_random_uuid(),
  finding_id uuid not null references audit_findings(id) on delete cascade,
  amenity_id uuid not null references amenities(id) on delete cascade,
  present    boolean not null,
  note       text,
  is_current boolean not null default true,
  unique (finding_id, amenity_id)
);
create table audit_finding_answers (
  id          uuid primary key default gen_random_uuid(),
  finding_id  uuid not null references audit_findings(id) on delete cascade,
  question_id uuid not null references audit_questions(id) on delete cascade,
  -- {"yes_no": true} / {"choice": "…"} / {"text": "…"} / {"meter": 123.4}
  value       jsonb not null,
  ticket_id   uuid references tickets(id) on delete set null,
  is_current  boolean not null default true,
  unique (finding_id, question_id)
);

create table audit_proposals (
  id                  uuid primary key default gen_random_uuid(),
  finding_id          uuid not null references audit_findings(id) on delete cascade,
  kind                audit_proposal_kind not null,
  -- Set by trigger from kind, never by the client, so RLS can trust it.
  structural          boolean not null default false,
  payload             jsonb not null default '{}',
  decision            audit_decision,
  decided_by_id       uuid references users(id),
  decided_at          timestamptz,
  reason              text,
  applied_location_id uuid references locations(id) on delete set null,
  is_current          boolean not null default true,
  constraint audit_proposals_reject_needs_reason
    check (decision is distinct from 'rejected' or nullif(btrim(reason), '') is not null)
);
create index audit_proposals_finding_idx on audit_proposals (finding_id);

alter table tickets
  add column source_finding_id uuid references audit_findings(id) on delete set null,
  add column proposal_id       uuid references audit_proposals(id) on delete set null;

-- ── triggers ──────────────────────────────────────────────────────────────

create function public.audit_proposal_set_structural() returns trigger
  language plpgsql set search_path = public
as $$
begin
  new.structural := new.kind in ('create_location','retire_location','rename','retype','reparent','move_placement');
  return new;
end $$;
create trigger audit_proposals_structural before insert or update of kind on audit_proposals
  for each row execute function public.audit_proposal_set_structural();

-- A finding lands only on an open audit. An upload from a phone that was
-- offline overnight must meet this too, which is why it is not a UI rule.
create function public.audit_finding_guard() returns trigger
  language plpgsql set search_path = public
as $$
declare s audit_status;
begin
  select status into s from audits where id = new.audit_id;
  if s is distinct from 'open' then
    raise exception 'audit % is %, findings are closed', new.audit_id, coalesce(s::text, 'missing')
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
-- Only the columns a person edits. The sync-scope refresh flips is_current on
-- finalized audits' findings, and that must not read as a late edit.
create trigger audit_findings_guard before insert or update of
    audit_id, target_id, recorded_by_id, occupied, contact_id, unexpected_occupancy,
    clearly_marked, mapped_correctly, displaced_note
  on audit_findings
  for each row execute function public.audit_finding_guard();

-- Recording a finding marks its target audited; when no target is pending
-- the audit closes itself. SECURITY DEFINER because the assignee recording
-- the finding does not hold manage_audits, which the target and audit
-- policies require.
create function public.audit_finding_after_write() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare a uuid;
begin
  if tg_op = 'DELETE' then
    if old.target_id is not null then
      update audit_targets set state = 'pending' where id = old.target_id and state = 'audited';
    end if;
    return old;
  end if;
  if new.target_id is not null then
    update audit_targets set state = 'audited' where id = new.target_id and state <> 'audited';
  end if;
  a := new.audit_id;
  if not exists (select 1 from audit_targets where audit_id = a and state = 'pending') then
    update audits set status = 'closed', closed_at = now()
     where id = a and status = 'open';
  end if;
  return new;
end $$;
create trigger audit_findings_after_write after insert or update or delete on audit_findings
  for each row execute function public.audit_finding_after_write();
revoke execute on function public.audit_finding_after_write() from public, anon, authenticated;
revoke execute on function public.audit_proposal_set_structural() from public, anon, authenticated;
revoke execute on function public.audit_finding_guard() from public, anon, authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['audit_templates','audits','audit_rules','audit_questions','audit_assignees',
                           'audit_targets','audit_findings','audit_finding_boats','audit_finding_vehicles',
                           'audit_finding_services','audit_finding_amenities','audit_finding_answers',
                           'audit_proposals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy tier0_select on public.%I for select using (public.is_active_marina_user())', t);
  end loop;

  -- Templates, launches, assignment and the target list: manage_audits.
  foreach t in array array['audit_templates','audits','audit_rules','audit_questions','audit_assignees','audit_targets']
  loop
    execute format($f$
      create policy audits_write on public.%I for all
        using (public.has_permission('manage_audits'))
        with check (public.has_permission('manage_audits'))
    $f$, t);
  end loop;

  -- A finding and its parts: any active user may record one (assignment is
  -- enforced in the UI and data layer, as ticket creation is ungated); only
  -- the author may change it, and only while the audit is open. The guard
  -- trigger refuses the write on a closed audit regardless.
  create policy findings_insert on audit_findings for insert
    with check (public.is_active_marina_user() and recorded_by_id = public.current_marina_user_id());
  create policy findings_author_update on audit_findings for update
    using (recorded_by_id = public.current_marina_user_id()
           and exists (select 1 from audits a where a.id = audit_id and a.status = 'open'))
    with check (recorded_by_id = public.current_marina_user_id());
  create policy findings_author_delete on audit_findings for delete
    using (recorded_by_id = public.current_marina_user_id()
           and exists (select 1 from audits a where a.id = audit_id and a.status = 'open'));

  foreach t in array array['audit_finding_boats','audit_finding_vehicles','audit_finding_services',
                           'audit_finding_amenities','audit_finding_answers']
  loop
    execute format($f$
      create policy finding_parts_author on public.%I for all
        using (exists (select 1 from audit_findings f join audits a on a.id = f.audit_id
                        where f.id = finding_id and f.recorded_by_id = public.current_marina_user_id()
                          and a.status = 'open'))
        with check (exists (select 1 from audit_findings f join audits a on a.id = f.audit_id
                             where f.id = finding_id and f.recorded_by_id = public.current_marina_user_id()
                               and a.status = 'open'))
    $f$, t);
  end loop;
end $$;

-- Proposals: the author writes them while the audit is open; a decider
-- changes them afterwards, and a structural one only with manage_locations.
create policy proposals_author on audit_proposals for all
  using (exists (select 1 from audit_findings f join audits a on a.id = f.audit_id
                  where f.id = finding_id and f.recorded_by_id = public.current_marina_user_id()
                    and a.status = 'open'))
  with check (exists (select 1 from audit_findings f join audits a on a.id = f.audit_id
                       where f.id = finding_id and f.recorded_by_id = public.current_marina_user_id()
                         and a.status = 'open'));
create policy proposals_decide on audit_proposals for update
  using (public.has_permission('manage_audits')
         and (not structural or public.has_permission('manage_locations')))
  with check (public.has_permission('manage_audits')
         and (not structural or public.has_permission('manage_locations')));

-- ── closing and finalizing ────────────────────────────────────────────────

create function public.close_audit(p_audit uuid) returns void
  language plpgsql security definer set search_path = public
as $$
declare a audits%rowtype;
begin
  if not public.has_permission('manage_audits') then
    raise exception 'manage_audits required' using errcode = 'insufficient_privilege';
  end if;
  select * into a from audits where id = p_audit for update;
  if a.id is null then raise exception 'no such audit'; end if;
  if a.status <> 'open' then return; end if;
  update audit_targets set state = 'not_audited', not_audited_reason = 'closed early'
   where audit_id = p_audit and state = 'pending';
  update audits set status = 'closed', closed_at = now(), closed_by_id = public.current_marina_user_id()
   where id = p_audit;
end $$;

-- The one path from an audit into marina structure. Refuses while any
-- proposal is undecided, and refuses approved structural proposals from a
-- user without manage_locations, so the approval queue cannot be used to
-- reshape the location tree by someone who only holds the audit key.
create function public.finalize_audit(p_audit uuid) returns void
  language plpgsql security definer set search_path = public
as $$
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

  update audits set status = 'finalized', finalized_at = now(), finalized_by_id = me where id = p_audit;
end $$;

revoke execute on function public.close_audit(uuid)    from public, anon;
revoke execute on function public.finalize_audit(uuid) from public, anon;
grant  execute on function public.close_audit(uuid)    to authenticated;
grant  execute on function public.finalize_audit(uuid) to authenticated;

-- ── sync scope ────────────────────────────────────────────────────────────

create function public.refresh_audit_sync_scopes() returns void
  language plpgsql security definer set search_path = public
as $$
declare finalized_trail constant interval := '30 days';
begin
  update audits set is_current = v.want
    from (select id, status <> 'finalized' or finalized_at >= now() - finalized_trail as want from audits) v
   where audits.id = v.id and audits.is_current is distinct from v.want;

  update audit_assignees x set is_current = a.is_current from audits a
   where a.id = x.audit_id and x.is_current is distinct from a.is_current;
  update audit_targets x set is_current = a.is_current from audits a
   where a.id = x.audit_id and x.is_current is distinct from a.is_current;
  update audit_findings x set is_current = a.is_current from audits a
   where a.id = x.audit_id and x.is_current is distinct from a.is_current;
  update audit_finding_boats x set is_current = f.is_current from audit_findings f
   where f.id = x.finding_id and x.is_current is distinct from f.is_current;
  update audit_finding_vehicles x set is_current = f.is_current from audit_findings f
   where f.id = x.finding_id and x.is_current is distinct from f.is_current;
  update audit_finding_services x set is_current = f.is_current from audit_findings f
   where f.id = x.finding_id and x.is_current is distinct from f.is_current;
  update audit_finding_amenities x set is_current = f.is_current from audit_findings f
   where f.id = x.finding_id and x.is_current is distinct from f.is_current;
  update audit_finding_answers x set is_current = f.is_current from audit_findings f
   where f.id = x.finding_id and x.is_current is distinct from f.is_current;
  update audit_proposals x set is_current = f.is_current from audit_findings f
   where f.id = x.finding_id and x.is_current is distinct from f.is_current;

  update service_meter_readings set is_recent = v.want
    from (select id, read_at >= now() - interval '90 days' as want from service_meter_readings) v
   where service_meter_readings.id = v.id and service_meter_readings.is_recent is distinct from v.want;
end $$;
revoke execute on function public.refresh_audit_sync_scopes() from public, anon, authenticated;

create or replace function public.refresh_sync_scopes_all() returns void
  language sql security definer set search_path = public
as $$
  select public.refresh_sync_scopes();
  select public.refresh_child_sync_scopes();
  select public.refresh_audit_sync_scopes();
$$;
