-- The Shift Report's snapshot and its public read
-- (src/pages/reports/ShiftReportPage.spec.md § The body is fixed at End of
-- Shift, § The Report Link).
--
-- The body is compiled on the guard's device at End Shift and Submit, the
-- only place guaranteed to hold everything they recorded, and stored here
-- once. Insert-only by policy: the paper report as handed in is never
-- rewritten. The server compiles nothing; shift_report() serves the document
-- back with what moved beneath its incidents and tickets since End of Shift.

create table shift_report_snapshots (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid not null unique references shifts(id) on delete cascade,
  document   jsonb not null,
  created_at timestamptz not null default now(),
  is_recent  boolean not null default true
);

alter table public.shift_report_snapshots enable row level security;
create policy tier0_select on public.shift_report_snapshots for select using (public.is_active_marina_user());
create policy tier0_insert on public.shift_report_snapshots for insert with check (public.is_active_marina_user());
revoke all on public.shift_report_snapshots from anon;

-- ── the public read ──────────────────────────────────────────────────────
-- Security definer, so anon reads nothing directly: the id is the credential
-- (spec § The Report Link). "ended" with the document and the rows that moved
-- since ended_at; "not_ended" with only the header for a shift with no
-- snapshot yet; null for an unknown id, which the page shows as one neutral
-- message.
create function public.shift_report(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s    record;
  doc  jsonb;
  marina text := (select marina_name from marina_settings limit 1);
begin
  select sh.id, sh.guard_id, sh.started_at, sh.ended_at, u.name as guard_name
    into s from shifts sh left join users u on u.id = sh.guard_id where sh.id = p_shift;
  if s.id is null then return null; end if;

  select document into doc from shift_report_snapshots where shift_id = p_shift;
  if doc is null then
    return jsonb_build_object(
      'status', 'not_ended',
      'header', jsonb_build_object(
        'marinaName', marina, 'guardName', s.guard_name,
        'startedAt', s.started_at, 'endedAt', s.ended_at));
  end if;

  return jsonb_build_object(
    'status', 'ended',
    'document', doc,
    'updates', jsonb_build_object(
      'incidentComments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'incident_id', c.incident_id, 'body', c.body,
          'created_at', c.created_at, 'author_name', a.name) order by c.created_at)
        from incident_comments c left join users a on a.id = c.author_id
        where c.created_at > s.ended_at
          and c.incident_id in (select (x->>'id')::uuid from jsonb_array_elements(doc->'incidents') x)), '[]'::jsonb),
      'incidentUpdates', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', u.id, 'incident_id', u.incident_id, 'kind', u.kind,
          'from_value', u.from_value, 'to_value', u.to_value,
          'created_at', u.created_at, 'author_name', a.name) order by u.created_at)
        from incident_updates u left join users a on a.id = u.author_id
        where u.created_at > s.ended_at
          and u.incident_id in (select (x->>'id')::uuid from jsonb_array_elements(doc->'incidents') x)), '[]'::jsonb),
      'ticketUpdates', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', u.id, 'ticket_id', u.ticket_id, 'kind', u.kind,
          'from_value', u.from_value, 'to_value', u.to_value, 'body', u.body,
          'created_at', u.created_at, 'author_name', a.name) order by u.created_at)
        from ticket_updates u left join users a on a.id = u.author_id
        where u.created_at > s.ended_at
          and u.ticket_id in (select (x->>'id')::uuid from jsonb_array_elements(doc->'tickets') x)), '[]'::jsonb)));
end $$;
revoke all on function public.shift_report(uuid) from public;
grant execute on function public.shift_report(uuid) to anon, authenticated;

-- ── sync scope: the snapshot reads its shift's flag ──────────────────────
create or replace function public.refresh_child_sync_scopes() returns void
  language plpgsql security definer set search_path = public
as $$
begin
  update contact_details cd set is_resident = c.is_resident
    from contacts c where c.id = cd.contact_id and cd.is_resident is distinct from c.is_resident;

  update lease_lessees x set is_current = l.is_current
    from leases l where l.id = x.lease_id and x.is_current is distinct from l.is_current;
  update lease_documents x set is_current = l.is_current
    from leases l where l.id = x.lease_id and x.is_current is distinct from l.is_current;
  update lease_comments x set is_current = l.is_current
    from leases l where l.id = x.lease_id and x.is_current is distinct from l.is_current;

  update boat_owners x set is_resident = b.is_resident
    from boats b where b.id = x.boat_id and x.is_resident is distinct from b.is_resident;
  update boat_authorized_users x set is_resident = b.is_resident
    from boats b where b.id = x.boat_id and x.is_resident is distinct from b.is_resident;
  update vehicle_owners x set is_resident = v.is_resident
    from vehicles v where v.id = x.vehicle_id and x.is_resident is distinct from v.is_resident;

  update incident_comments x set is_recent = i.is_recent
    from incidents i where i.id = x.incident_id and x.is_recent is distinct from i.is_recent;
  update incident_updates x set is_recent = i.is_recent
    from incidents i where i.id = x.incident_id and x.is_recent is distinct from i.is_recent;
  update ticket_updates x set is_recent = t.is_recent
    from tickets t where t.id = x.ticket_id and x.is_recent is distinct from t.is_recent;
  update shift_report_snapshots x set is_recent = s.is_recent
    from shifts s where s.id = x.shift_id and x.is_recent is distinct from s.is_recent;

  update checklist_instance_sections x set is_recent = ci.is_recent
    from checklist_instances ci where ci.id = x.instance_id and x.is_recent is distinct from ci.is_recent;
  update checklist_instance_items x set is_recent = s.is_recent
    from checklist_instance_sections s where s.id = x.section_id and x.is_recent is distinct from s.is_recent;

  update call_notes x set is_recent = c.is_recent
    from calls c where c.id = x.call_id and x.is_recent is distinct from c.is_recent;
  update sms_messages x set is_recent = t.is_recent
    from sms_threads t where t.id = x.thread_id and x.is_recent is distinct from t.is_recent;

  update chat_room_users x set is_recent = r.is_recent
    from chat_rooms r where r.id = x.room_id and x.is_recent is distinct from r.is_recent;
  update chat_room_roles x set is_recent = r.is_recent
    from chat_rooms r where r.id = x.room_id and x.is_recent is distinct from r.is_recent;
  update chat_messages x set is_recent = r.is_recent
    from chat_rooms r where r.id = x.room_id and x.is_recent is distinct from r.is_recent;
  update chat_message_attachments x set is_recent = m.is_recent
    from chat_messages m where m.id = x.message_id and x.is_recent is distinct from m.is_recent;
end $$;
revoke all on function public.refresh_child_sync_scopes() from public, anon, authenticated;
