-- Correct checklist_item_type against reality.
--
-- The original enum was derived from the conventions comment at the top of
-- instant.schema.ts, which lists:
--     simple_check / verify_task / door_check / gas_pump_check /
--     location_check / meter_reading
--
-- The exported data disagrees, and the data is right. Real rows use
-- `lock_check` and `question`; `gas_pump_check` appears nowhere. Lock Check
-- shipped briefly under the old name before being generalised past fuel pumps
-- (a padlocked gate and a shed hasp are the same check), and
-- scripts/migrate-gas-pump-to-lock-check.mjs renamed it. `question` was added
-- later and the comment was never updated.
--
-- ITEM_TYPE_LABEL in src/lib/checklists.ts is the authority, and this now
-- matches it. gas_pump_check is deliberately NOT carried forward: the app maps
-- it on read via LEGACY_ITEM_TYPES, and the transform normalises it, so no row
-- reaches Postgres still carrying it.
--
-- Rebuilt rather than extended because Postgres cannot drop an enum value, and
-- every table using this type is empty — this is the cheapest this correction
-- will ever be.

alter table checklist_template_items alter column type type text;
drop type checklist_item_type;
create type checklist_item_type as enum (
  'simple_check',
  'verify_task',
  'door_check',
  'lock_check',
  'location_check',
  'meter_reading',
  'question'
);
alter table checklist_template_items
  alter column type type checklist_item_type using type::checklist_item_type;
