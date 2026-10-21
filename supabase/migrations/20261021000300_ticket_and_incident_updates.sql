-- Ticket Updates and Incident Updates: a permanent history for the two
-- records the Shift Report shows "as of End of Shift, with what changed since
-- beneath" (src/pages/tickets/TicketDetailPage.spec.md § Ticket Updates,
-- src/pages/incidents/IncidentDetailPage.spec.md § The timeline, ADR 0008).
--
-- The Activity Log could not serve: the retention purge removes it, and a
-- ticket's history is needed for as long as the ticket is. Both tables are
-- INSERT-ONLY, by policy: history is written once. They are written by the
-- app, in the transaction that makes the change, so an offline edit keeps
-- its real time and author; a trigger would stamp the upload. Nothing is
-- backfilled - neither system was in production use.

create table ticket_updates (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  kind        text not null check (kind in ('created', 'status', 'priority', 'assignee', 'comment')),
  -- The names at the time (status name, priority, user name), so the
  -- timeline still reads right after a rename or a deactivation.
  from_value  text,
  to_value    text,
  body        text,                       -- markdown; comment only
  created_at  timestamptz not null default now(),
  author_id   uuid references users(id) on delete set null,
  is_recent   boolean not null default true
);
create index ticket_updates_ticket_idx on ticket_updates (ticket_id, created_at);

create table incident_updates (
  id                  uuid primary key default gen_random_uuid(),
  incident_id         uuid not null references incidents(id) on delete cascade,
  kind                text not null check (kind in ('status', 'assignee')),
  from_value          text,
  to_value            text,
  created_at          timestamptz not null default now(),
  author_id           uuid references users(id) on delete set null,
  required_permission text not null default 'view_incidents',
  is_recent           boolean not null default true
);
create index incident_updates_incident_idx on incident_updates (incident_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Tier 0 for ticket_updates, like tickets, less update and delete. Tier 1
-- for incident_updates, like incident_comments, less update and delete.
-- The policy loop in 001600 ran before these existed.
alter table public.ticket_updates enable row level security;
create policy tier0_select on public.ticket_updates for select using (public.is_active_marina_user());
create policy tier0_insert on public.ticket_updates for insert with check (public.is_active_marina_user());
revoke all on public.ticket_updates from anon;

alter table public.incident_updates enable row level security;
create policy incident_updates_select on public.incident_updates for select using (public.has_permission('view_incidents'));
create policy incident_updates_insert on public.incident_updates for insert with check (public.has_permission('create_incidents'));
revoke all on public.incident_updates from anon;

-- ── sync scope: a child reads its parent's flag ──────────────────────────
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
