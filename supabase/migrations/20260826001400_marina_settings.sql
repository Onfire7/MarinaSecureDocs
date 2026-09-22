-- Marina-level configuration. Exactly one row, ever.

create table marina_settings (
  id                            integer primary key default 1,
  marina_name                   text,
  gps_validation_radius_default integer not null default 50,   -- metres
  activity_log_retention_days   integer not null default 365,
  call_recording_enabled        boolean not null default false,
  call_transcription_enabled    boolean not null default false,
  -- A plain list of addresses; text[] is honest about that where a jsonb blob
  -- was not.
  shift_report_recipients       text[] not null default '{}',
  allow_overlapping_reservations boolean not null default false,
  -- ask / customer — whether hauling a boat out prompts for who did it. A
  -- marina haul-out raises a Ticket; a customer one does not.
  haul_out_mode                 haul_out_mode not null default 'ask',
  constraint marina_settings_singleton check (id = 1)
);

-- Was a jsonb array on marina_settings. The Twilio Function routes an inbound
-- call by looking the dialled number up here; parsing a blob to do it was
-- incidental complexity.
create table phone_lines (
  id      uuid primary key default gen_random_uuid(),
  number  text not null unique,
  label   text not null,
  routing jsonb
);
