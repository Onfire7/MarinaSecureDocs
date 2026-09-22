-- Communications.
--
-- Every row here is written by a Twilio Function using a dedicated Postgres
-- role scoped to these tables — never the service-role key, which bypasses RLS
-- entirely and would turn a leaked Twilio env var into full marina exposure.
-- See docs/api-structure.md.

create table calls (
  id            uuid primary key default gen_random_uuid(),
  direction     comms_direction not null,
  line          text,
  from_number   text,
  to_number     text,
  started_at    timestamptz,
  duration      integer,                    -- seconds
  recording_url text,
  transcript    text,
  missed        boolean not null default false,
  voicemail_url text,
  contact_id    uuid references contacts(id) on delete set null
);
create index calls_started_idx on calls (started_at desc);
create index calls_missed_idx on calls (missed) where missed;
create index calls_contact_idx on calls (contact_id);

create table call_notes (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid not null references calls(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  author_id  uuid references users(id)
);

create table sms_threads (
  id              uuid primary key default gen_random_uuid(),
  line            text,
  contact_id      uuid references contacts(id) on delete set null,
  -- Written by the Twilio Function alongside the message — not by a trigger
  -- and not by the client, because it is a Twilio-sourced value.
  last_message_at timestamptz,
  -- NOT denormalisation: nobody derives this, somebody marked it.
  unread          boolean not null default false
);
create index sms_threads_recent_idx on sms_threads (last_message_at desc);
create index sms_threads_unread_idx on sms_threads (unread) where unread;

create table sms_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references sms_threads(id) on delete cascade,
  direction  comms_direction not null,
  body       text not null,
  timestamp  timestamptz not null default now(),
  sent_by_id uuid references users(id)
);
create index sms_messages_thread_idx on sms_messages (thread_id, timestamp);

create table sms_templates (
  id       uuid primary key default gen_random_uuid(),
  label    text not null,
  body     text not null,
  scope    template_scope not null default 'global',
  owner_id uuid references users(id) on delete cascade,
  constraint personal_template_needs_owner
    check (scope <> 'personal' or owner_id is not null)
);

create table chat_rooms (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  topic         text,
  created_at    timestamptz not null default now(),
  created_by_id uuid references users(id)
);

-- Participation is not stored as a status; it is computed from creator, direct
-- invites and role invites. invitedRoles is a live reference, so someone
-- granted that role later gains access without being re-invited.
create table chat_room_users (
  room_id uuid not null references chat_rooms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (room_id, user_id)
);

create table chat_room_roles (
  room_id uuid not null references chat_rooms(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (room_id, role_id)
);

create table chat_messages (
  id        uuid primary key default gen_random_uuid(),
  room_id   uuid not null references chat_rooms(id) on delete cascade,
  author_id uuid references users(id),
  body      text not null,
  timestamp timestamptz not null default now()
);
create index chat_messages_room_idx on chat_messages (room_id, timestamp);

create table chat_message_attachments (
  message_id    uuid not null references chat_messages(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  primary key (message_id, attachment_id)
);
