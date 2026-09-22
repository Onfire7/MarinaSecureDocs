-- A check-in must outlive the checkpoint it recorded.
--
-- The export contains one check-in of 151 whose checkpoint no longer exists —
-- scanned, with GPS, from a tag that was later removed. The original schema
-- made checkpoint_id NOT NULL with ON DELETE CASCADE, which is wrong twice:
-- that row could not be migrated at all, and deleting a checkpoint would
-- silently erase every check-in ever recorded at it.
--
-- A check-in is evidence that somebody was physically at a place at a time.
-- Removing an NFC tag is a configuration change; it is not a statement that
-- the rounds never happened. This is the same reasoning that keeps
-- activity_log_entries pointing at subject_id without a foreign key: the
-- record outlives what it describes.
alter table check_ins alter column checkpoint_id drop not null;
alter table check_ins drop constraint check_ins_checkpoint_id_fkey;
alter table check_ins add constraint check_ins_checkpoint_id_fkey
  foreign key (checkpoint_id) references checkpoints(id) on delete set null;

comment on column check_ins.checkpoint_id is
  'Null when the checkpoint has since been deleted. The check-in is retained: it is evidence of presence, not configuration.';
