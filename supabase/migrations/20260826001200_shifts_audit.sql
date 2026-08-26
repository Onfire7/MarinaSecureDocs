-- Shifts and the Activity Log.

create table shifts (
  id                        uuid primary key default gen_random_uuid(),
  guard_id                  uuid not null references users(id),
  started_at                timestamptz not null default now(),
  ended_at                  timestamptz,
  -- Written by the Twilio Function that actually sends the report, per the
  -- Twilio-source-of-truth rule in docs/architecture.md.
  report_sent_at            timestamptz,
  end_of_shift_checklist_id uuid unique references checklist_instances(id) on delete set null
);
create index shifts_window_idx on shifts (started_at desc);
-- The shift-report backstop sweep looks for exactly this.
create index shifts_unsent_idx on shifts (ended_at) where ended_at is not null and report_sent_at is null;

-- Immutable, write-time audit record. Insert always; update only the protected
-- flag; DELETE NEVER from a client — the pg_cron purge in 1600 is the only
-- thing that removes an entry.
--
-- The largest table by a wide margin: an estimated 100k-250k rows a year,
-- which is what makes retention mandatory rather than optional.
create table activity_log_entries (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,               -- e.g. 'ticket.created'
  summary      text not null,
  timestamp    timestamptz not null default now(),
  -- Exempts the entry from the retention purge, for legal or evidentiary
  -- reasons.
  protected    boolean not null default false,
  -- The record the event happened to. Deliberately NOT a foreign key: the log
  -- outlives what it describes, and a cascade would erase the evidence along
  -- with the evidence's subject.
  subject_type text not null,
  subject_id   uuid not null,
  actor_id     uuid references users(id)
);
create index activity_log_timestamp_idx on activity_log_entries (timestamp desc);
create index activity_log_subject_idx on activity_log_entries (subject_type, subject_id);
create index activity_log_event_type_idx on activity_log_entries (event_type);
-- The purge scans by age and skips protected rows.
create index activity_log_purge_idx on activity_log_entries (timestamp) where not protected;
