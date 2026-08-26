-- Attachments.
--
-- PowerSync replicates rows, not blobs, so the row and the bytes travel
-- separately: this row syncs normally while the file drains through a local
-- upload queue. A row created offline is 'pending' until its bytes land, and
-- renders as pending rather than broken — the attachment's *existence* is
-- never lost. See docs/architecture.md — Attachments.

create table attachments (
  id             uuid primary key default gen_random_uuid(),
  storage_path   text not null unique,
  content_type   text,
  byte_size      bigint,
  upload_state   upload_state not null default 'pending',
  uploaded_by_id uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);
