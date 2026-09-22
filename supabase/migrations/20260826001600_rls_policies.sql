-- Row-level security.
--
-- Three tiers (docs/permissions.md — Enforcement):
--   Tier 0  every table: an active marina user, or nothing.
--   Tier 1  the sensitive tables, gated on a named permission. Drawn around
--           the data a GUEST would care about leaking.
--   Tier 2  the remainder, enforced in the UI only — a deliberate stopping
--           point, recorded rather than implied.
--
-- RLS is enabled on EVERY table by loop rather than by hand, because the
-- failure mode of a hand-maintained list is a table nobody remembers to add,
-- and that table is then world-readable to anyone holding the publishable key.

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    -- ENABLE, not FORCE: FORCE would apply RLS to the table owner as well,
    -- which breaks migrations and seeding while buying nothing — PostgREST
    -- connects as anon/authenticated and never as the owner.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ── Tier 0 ────────────────────────────────────────────────────────────────
-- Everything not named in the Tier 1 block below. Listed by exclusion so a
-- table added later inherits the baseline instead of silently having no
-- policy at all (RLS on with no policy = deny everything, which looks like
-- the app being broken).
do $$
declare
  t text;
  tier1 text[] := array[
    'incidents','incident_comments',
    'contacts','contact_details',
    'leases','lease_lessees','lease_documents','lease_comments',
    'calls','call_notes','sms_threads','sms_messages',
    'roles','user_roles','users','activity_log_entries'
  ];
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename <> all(tier1)
  loop
    execute format($f$
      create policy tier0_select on public.%I for select using (public.is_active_marina_user());
      create policy tier0_insert on public.%I for insert with check (public.is_active_marina_user());
      create policy tier0_update on public.%I for update using (public.is_active_marina_user())
                                                   with check (public.is_active_marina_user());
      create policy tier0_delete on public.%I for delete using (public.is_active_marina_user());
    $f$, t, t, t, t);
  end loop;
end $$;

-- ── Tier 1 ────────────────────────────────────────────────────────────────

-- Incidents. A non-holder gets zero rows, not an error — which is why the
-- UI must render "nothing to show" rather than treating empty as failure.
create policy incidents_select on incidents for select using (public.has_permission('view_incidents'));
create policy incidents_insert on incidents for insert with check (public.has_permission('create_incidents'));
create policy incidents_update on incidents for update using (public.has_permission('create_incidents'))
                                                with check (public.has_permission('create_incidents'));
-- No delete policy: incidents are never deleted from a client.

create policy incident_comments_select on incident_comments for select using (public.has_permission('view_incidents'));
create policy incident_comments_insert on incident_comments for insert with check (public.has_permission('create_incidents'));
create policy incident_comments_update on incident_comments for update using (public.has_permission('create_incidents'))
                                                                with check (public.has_permission('create_incidents'));

-- Contacts: identity vs reachable details. A user with view_owner but not
-- view_contact sees WHO someone is and never receives their phone or email.
create policy contacts_select on contacts for select using (public.has_permission('view_owner'));
create policy contacts_write  on contacts for all    using (public.has_permission('edit_owner_contact'))
                                                     with check (public.has_permission('edit_owner_contact'));

create policy contact_details_select on contact_details for select using (public.has_permission('view_contact'));
create policy contact_details_write  on contact_details for all    using (public.has_permission('edit_owner_contact'))
                                                                   with check (public.has_permission('edit_owner_contact'));

-- Leases and everything hanging off them.
create policy leases_select on leases for select using (public.has_permission('view_lease'));
create policy leases_write  on leases for all    using (public.has_permission('manage_lease'))
                                                 with check (public.has_permission('manage_lease'));
create policy lease_lessees_select on lease_lessees for select using (public.has_permission('view_lease'));
create policy lease_lessees_write  on lease_lessees for all    using (public.has_permission('manage_lease'))
                                                               with check (public.has_permission('manage_lease'));
create policy lease_documents_select on lease_documents for select using (public.has_permission('view_lease'));
create policy lease_documents_write  on lease_documents for all    using (public.has_permission('manage_lease'))
                                                                   with check (public.has_permission('manage_lease'));
create policy lease_comments_select on lease_comments for select using (public.has_permission('view_lease'));
create policy lease_comments_write  on lease_comments for all    using (public.has_permission('manage_lease'))
                                                                 with check (public.has_permission('manage_lease'));

-- Telephony. view_calls / view_sms are independent of place_calls: a user may
-- see calls without placing them, or the reverse.
create policy calls_select on calls for select using (public.has_permission('view_calls'));
create policy calls_write  on calls for all    using (public.has_permission('place_calls'))
                                               with check (public.has_permission('place_calls'));
create policy call_notes_select on call_notes for select using (public.has_permission('view_calls'));
create policy call_notes_write  on call_notes for all    using (public.has_permission('view_calls'))
                                                         with check (public.has_permission('view_calls'));
create policy sms_threads_select on sms_threads for select using (public.has_permission('view_sms'));
create policy sms_threads_write  on sms_threads for all    using (public.has_permission('place_calls'))
                                                           with check (public.has_permission('place_calls'));
create policy sms_messages_select on sms_messages for select using (public.has_permission('view_sms'));
create policy sms_messages_write  on sms_messages for all    using (public.has_permission('place_calls'))
                                                             with check (public.has_permission('place_calls'));

-- ── Roles, users, and the escalation vector ADR 0002 recorded ─────────────

create policy roles_select on roles for select using (public.is_active_marina_user());
create policy roles_write  on roles for all    using (public.has_permission('manage_roles'))
                                               with check (public.has_permission('manage_roles'));

-- This is the acceptance criterion ADR 0005 carries forward. Granting yourself
-- a role is an INSERT here, and it requires manage_roles. Under InstantDB this
-- was a link on a user row whose update rule was per-entity, so any active
-- user could reach it.
create policy user_roles_select on user_roles for select using (public.is_active_marina_user());
create policy user_roles_write  on user_roles for all    using (public.has_permission('manage_roles'))
                                                         with check (public.has_permission('manage_roles'));

create policy users_select on users for select using (public.is_active_marina_user());
create policy users_insert on users for insert
  with check (public.has_permission('manage_users') or public.has_permission('manage_roles'));
-- A user may edit their own row (dashboard layout, phone), but role
-- assignment is not reachable from here — it lives in user_roles.
create policy users_update on users for update
  using (id = public.current_marina_user_id()
         or public.has_permission('manage_users') or public.has_permission('manage_roles'))
  with check (id = public.current_marina_user_id()
         or public.has_permission('manage_users') or public.has_permission('manage_roles'));
-- No delete policy: users are deactivated, never deleted, so history survives.

-- ── Activity Log ─────────────────────────────────────────────────────────
-- Insert always; update only to set the Protected flag; DELETE NEVER from any
-- client, whatever their permissions. The pg_cron purge is the only thing that
-- removes an entry, which is what makes the log evidentiary.
create policy activity_log_select on activity_log_entries for select using (public.is_active_marina_user());
create policy activity_log_insert on activity_log_entries for insert with check (public.is_active_marina_user());
create policy activity_log_update on activity_log_entries for update using (public.is_active_marina_user())
                                                                     with check (public.is_active_marina_user());
-- Deliberately no delete policy. Absence is the enforcement.
