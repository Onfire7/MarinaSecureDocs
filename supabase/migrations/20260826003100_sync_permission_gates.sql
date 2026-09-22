-- Make permission gating expressible in a sync rule.
--
-- A sync data query can only produce a bucket parameter by comparing a ROW
-- COLUMN to a request-keyed subquery. Comparing a LITERAL does not compile:
--
--   'view_incidents' IN (SELECT permission FROM ... )   -> bucket "incidents[]"      (no gate)
--   required_permission IN (SELECT permission FROM ...) -> bucket "incidents[view_incidents]"
--
-- So the permission a row requires has to BE on the row. It is constant per
-- table, which makes the column look redundant — it is not: it is the only
-- handle the sync engine has. Proven by revoking view_incidents from every
-- role and watching the parameter lookup stop offering it.
--
-- No CHECK pinning the value: a marina that later wants incidents gated
-- differently should be able to, and the default carries the intent.

alter table incidents         add column required_permission text not null default 'view_incidents';
alter table incident_comments add column required_permission text not null default 'view_incidents';
alter table contacts          add column required_permission text not null default 'view_owner';
alter table contact_details   add column required_permission text not null default 'view_contact';
alter table leases            add column required_permission text not null default 'view_lease';
alter table lease_lessees     add column required_permission text not null default 'view_lease';
alter table lease_documents   add column required_permission text not null default 'view_lease';
alter table lease_comments    add column required_permission text not null default 'view_lease';
alter table calls             add column required_permission text not null default 'view_calls';
alter table call_notes        add column required_permission text not null default 'view_calls';
alter table sms_threads       add column required_permission text not null default 'view_sms';
alter table sms_messages      add column required_permission text not null default 'view_sms';

-- ── scope flags on child rows ────────────────────────────────────────────
-- A child cannot be scoped by a subquery off its parent, for the same reason:
-- the filter must be a row value. Each carries its parent's flag, maintained
-- in the same refresh.
alter table contact_details             add column is_resident boolean not null default false;
alter table lease_lessees               add column is_current  boolean not null default false;
alter table lease_documents             add column is_current  boolean not null default false;
alter table lease_comments              add column is_current  boolean not null default false;
alter table boat_owners                 add column is_resident boolean not null default false;
alter table boat_authorized_users       add column is_resident boolean not null default false;
alter table vehicle_owners              add column is_resident boolean not null default false;
alter table incident_comments           add column is_recent   boolean not null default true;
alter table checklist_instance_sections add column is_recent   boolean not null default true;
alter table checklist_instance_items    add column is_recent   boolean not null default true;
alter table call_notes                  add column is_recent   boolean not null default true;
alter table sms_messages                add column is_recent   boolean not null default true;
alter table chat_room_users             add column is_recent   boolean not null default true;
alter table chat_room_roles             add column is_recent   boolean not null default true;
alter table chat_messages               add column is_recent   boolean not null default true;
alter table chat_message_attachments    add column is_recent   boolean not null default true;

create or replace function public.refresh_child_sync_scopes() returns void
  language plpgsql security definer set search_path = public
as $$
begin
  -- Every update guarded by `is distinct from`: an unguarded rewrite is a
  -- replication event per row, which would push the whole table through the
  -- sync pipe on every refresh.
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

-- Children are refreshed after parents, in the same job, because a child's
-- flag is derived from a parent flag this call has just recomputed.
create or replace function public.refresh_sync_scopes_all() returns void
  language sql security definer set search_path = public
as $$
  select public.refresh_sync_scopes();
  select public.refresh_child_sync_scopes();
$$;
revoke all on function public.refresh_sync_scopes_all() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('refresh-sync-scopes')
      where exists (select 1 from cron.job where jobname = 'refresh-sync-scopes');
    perform cron.schedule('refresh-sync-scopes', '7 * * * *',
                          'select public.refresh_sync_scopes_all()');
  end if;
end $$;
