-- checklist_template_items.section_id must be nullable.
--
-- Copy-on-edit is the reason. Editing an item writes a NEW row and repoints
-- the section at it; the OLD row is deliberately left orphaned from the
-- section while keeping its instance references, so every historical
-- checklist item still resolves to the exact wording and config it was
-- completed against. instant.schema.ts says this outright — "older rows are
-- orphaned from the section but keep their instance references" — and the
-- exported data confirms it: 5 of 79 template items have no section, and 5
-- instance items still point at them.
--
-- NOT NULL would have forced dropping those 5 rows, which would silently
-- orphan completed checklist history. That is the same failure
-- scripts/migrate-gas-pump-to-lock-check.mjs was written to avoid, and it is
-- invisible until someone opens a months-old checklist and finds it blank.
--
-- The live version of an item is whichever row its section currently points
-- at. A null section_id means "superseded", and that is load-bearing rather
-- than missing data.
alter table checklist_template_items alter column section_id drop not null;

comment on column checklist_template_items.section_id is
  'Null means this version was superseded by a copy-on-edit and is retained only for the instance items that reference it.';
