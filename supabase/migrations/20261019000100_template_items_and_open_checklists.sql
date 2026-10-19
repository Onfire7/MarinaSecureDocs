-- Two changes behind "Update open checklists" on the template builder.
--
-- 1. A delete of a template item that a checklist still reads through is an
--    orphan, not an error.
--
-- An instance item reads its label, type and config through the exact
-- template-item row it was created from, and checklist_instance_items.
-- template_item_id has no ON DELETE clause, so such a row cannot be deleted.
-- The builder knows this, and orphans (section_id = null) rather than deletes
-- any row it sees referenced. But it sees only what the device holds, which is
-- every open checklist and the last 30 days of closed ones. A row read only by
-- an older checklist looks unreferenced, so the builder deleted it. Postgres
-- refused with 23503, the connector discarded the write as unretryable, and
-- the row synced back into the template: editing such an item left the old
-- wording beside the new, and removing one did nothing.
--
-- The question "does anything still read this?" can only be answered here, so
-- it is answered here: the delete becomes the orphan the builder would have
-- written had it known. Unreferenced rows still delete.
--
-- 2. checklist_instances.created_at and checklist_instance_sections.created_at.
--
-- Updating an open checklist re-resolves Due by for anything still hidden, and
-- an offset rule ("due 90 minutes after creation") cannot be re-resolved
-- without the creation time. Nothing stored it. The client writes it, since a
-- row may be created offline long before it is uploaded; the default covers
-- anything else.
--
-- Nullable, and the default is set AFTER the column is added, so existing rows
-- are left null rather than stamped with the moment of this migration, which
-- would be a confident wrong answer. A null created_at means "unknown", and
-- the updater leaves that row's Due by alone.

create function public.orphan_referenced_template_item() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from checklist_instance_items where template_item_id = old.id) then
    update checklist_template_items set section_id = null where id = old.id;
    return null;  -- skip the delete; the row stays for whoever reads it
  end if;
  return old;
end $$;

create trigger checklist_template_items_orphan_if_referenced
  before delete on public.checklist_template_items
  for each row execute function public.orphan_referenced_template_item();

revoke execute on function public.orphan_referenced_template_item() from public, anon, authenticated;

alter table public.checklist_instances add column created_at timestamptz;
alter table public.checklist_instances alter column created_at set default now();

alter table public.checklist_instance_sections add column created_at timestamptz;
alter table public.checklist_instance_sections alter column created_at set default now();
