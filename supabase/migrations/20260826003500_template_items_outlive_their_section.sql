-- A checklist template item outlives its section, the same way it already
-- outlives its own edits.
--
-- Editing a template item does not change it. The old row is orphaned from its
-- section and a new one takes its place, because every instance item already
-- created reads its label, type and config back through the exact version it
-- was made from — that is what stops an edit rewriting the history of every
-- round already walked. Five such orphans exist in this marina's real data,
-- and migration 20260826002300 exists to keep them.
--
-- Deleting a template was supposed to work the same way: the template and its
-- sections go, the item rows stay. It could not. section_id cascaded, so
-- deleting a template deleted its items, and checklist_instance_items.
-- template_item_id has no ON DELETE clause — so the delete was REFUSED for any
-- template that had ever generated a checklist, which is every template worth
-- deleting. The intent was written down in the admin page and contradicted by
-- the schema.
--
-- SET NULL rather than CASCADE reconciles them: a deleted template leaves its
-- items orphaned exactly as an edited one does, and the checklists generated
-- from it keep rendering. An orphaned item is not litter here — it is the
-- record of what someone was actually asked to check.
alter table checklist_template_items
  drop constraint checklist_template_items_section_id_fkey;

alter table checklist_template_items
  add constraint checklist_template_items_section_id_fkey
  foreign key (section_id) references checklist_template_sections(id)
  on delete set null;
