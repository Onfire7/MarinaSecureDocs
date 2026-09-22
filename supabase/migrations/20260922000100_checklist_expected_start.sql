-- When a checklist is DUE to start, so a hide-until knows which day it means.
--
-- A hide-until rule is a clock time ("20:00"), and it was given a date by
-- rolling forward from the moment the checklist was created. That is right
-- only if the checklist is created before every reveal inside it. It was not,
-- on the night a guard clocked in at 10:33 PM: the 7, 8 and 9 PM sections
-- resolved to the FOLLOWING evening and stayed hidden for the whole shift.
-- Started after midnight it fails differently and no better — 8 PM resolves to
-- later that same calendar date, nineteen hours off, when the right answer is
-- 8 PM on the previous date, which rolling forward can never produce.
--
-- expected_start lives on the template, beside the hide_until_rule it gives
-- meaning to. Deliberately not on the shift, and not a marina setting: the
-- thing that knows when a checklist is meant to begin is the checklist, and an
-- answer derived from who clocked in when is an answer that changes when they
-- do.
--
-- expected_start_at is that rule resolved ONCE, at creation, to a moment — the
-- nearest occurrence of expected_start. It is stored because sections are
-- added to a live checklist hours later (a checkpoint scan, a location
-- visit), and by 6 AM "the nearest 5 PM" is no longer the evening the
-- checklist belongs to.
--
-- Both nullable, no backfill: a template with no expected start behaves
-- exactly as before, and so does every checklist already in progress.

alter table checklist_templates
  add column expected_start text
  constraint checklist_templates_expected_start_is_a_clock_time
    check (expected_start is null or expected_start ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$');

alter table checklist_instances
  add column expected_start_at timestamptz;
