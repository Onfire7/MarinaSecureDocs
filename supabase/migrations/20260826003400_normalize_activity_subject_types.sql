-- activity_log_entries.subject_type, in one convention instead of two.
--
-- The column names the kind of thing an entry is about, and the app uses it
-- twice: to pick the label ("Check-in") and to build the link to the subject's
-- own page. Both are lookups against a fixed set, and a value outside that set
-- renders as nothing useful.
--
-- The exported InstantDB data uses Instant's namespace names — checkIns,
-- checklistInstances, smsThreads — while everything written since the move
-- uses table names. Both are in the table right now: 168 rows say `checkIns`
-- and 5,823 say `check_ins`, for the same kind of event. Whichever convention
-- the rewritten client picks, the other half of the log breaks.
--
-- Table names win, because they are the only convention with an authority
-- outside this file: subject_type now names a table that exists, and
-- subject_id is a row in it.
update activity_log_entries set subject_type = 'check_ins'
 where subject_type = 'checkIns';
update activity_log_entries set subject_type = 'checklist_instances'
 where subject_type in ('checklistInstances', 'checklists');
update activity_log_entries set subject_type = 'sms_threads'
 where subject_type = 'smsThreads';

-- `checklists` above is the interesting one. Its 27 rows are all
-- checklist.completed, and none of their subject_ids exist in
-- checklist_instances OR checklist_templates — they refer to instances that
-- were deleted long ago. That is not a defect to repair: an activity log is
-- immutable and its entries carry their own summary text, so an entry
-- outliving its subject is the log working. The client must therefore treat a
-- dangling subject as normal and render the entry without a link, rather than
-- assuming subject_id resolves.

-- The constraint is what stops this drifting again. It is deliberately a
-- literal list rather than a foreign key: subject rows are deleted and their
-- entries are meant to survive that, which is exactly what an FK would forbid.
alter table activity_log_entries
  add constraint activity_log_entries_subject_type_check
  check (subject_type in (
    'assets', 'boats', 'calls', 'check_ins', 'checklist_instances', 'contacts',
    'incidents', 'leases', 'locations', 'notes', 'reservations', 'roles',
    'shifts', 'sms_threads', 'tickets', 'users', 'vehicles'
  ));
