# Admin — Checklist Templates

`/admin/checklist-templates`. Gated entirely by `manage_checklists`.

Build and manage the reusable Templates that generate Checklists: a
role-owned Template, its ordered Sections (each with its own Trigger, place
and time rules), and the Items inside them. Desktop is the primary surface,
since there is a lot of configuration per item. Mobile supports viewing and
light edits.

Every Template belongs to one Role. There is no Global or Personal
visibility; personal checklists will return later as their own feature.

## What a template holds

| Field | Source | Notes |
|---|---|---|
| Name, assigned role | `checklist_templates.name` / `assigned_role_id` | The role is required and is flagged until it is set. Until then, instances fall back to the user who triggered them, so nothing is created that no query can reach. |
| Viewer roles | `template_viewer_roles` | A checkbox list of the other roles, giving read-only monitoring. |
| Assignment | `assigned_to_user` | Either assign each checklist to whoever triggers it, or leave it unclaimed for the role pool. |
| Trigger | `trigger_type` / `trigger_config` | Manual, Clock In/Out, Checkpoint Visit, or Recurring. Recurring takes an RRULE day rule (days only; the time of day belongs to Hide until). A Checkpoint Visit template is triggered through the checkpoints named on its sections. |
| Expected start, Hide until, Due by | `expected_start` / `hide_until_rule` / `due_by` | Authored rules. They are resolved to concrete timestamps on each instance when it is created, and exist on the template and on every section. |
| Sections | `checklist_template_sections`, ordered | Each has a name, an active toggle, its own trigger (Always, Recurring days, Checkpoint scan, Location visit, Asset, Location status), one location, checkpoints in that location, assets, its time rules, and its ordered items. |

## Actions

- **Create, edit, duplicate or delete a template.** A new template gets a
  placeholder name and opens straight into the builder, where the name field
  is. Duplicate copies the template, its sections, and fresh item rows,
  restarting at version 1 because the copy has no history. Delete removes the
  template and its sections but **keeps the item rows**. Items on checklists
  already generated keep rendering through those rows, the same way a
  superseded version survives an edit.
- **Add, reorder or remove a section.** The name is edited inline and sections
  reorder by drag handle. Deleting one asks for confirmation. Inactive sections
  are never added to a new checklist.
- **Set a section's location and checkpoints.** A section has exactly one
  location, and the checkpoint picker only offers checkpoints in it. Changing
  the location drops any attachments that no longer match.
- **Add, reorder or remove an item.** A new item's label starts as its type's
  name. A Door Check's or Lock Check's location defaults to its section's.
  Reordering writes in place, because order is presentation and never a
  version.
- **Edit an item's label or config.** Saved on commit (blur or save), not per
  keystroke. Duplicate copies the type and config to the end of the list as a
  fresh version-1 row.
- **Update open checklists.** See below.

## End Shift Items

An End Shift Item submits its checklist and carries the guard on to the end
of their shift (`src/pages/checklists/ActiveChecklistPage.spec.md` § End
Shift Item). Because it submits everything above it, the editor holds it to
a few rules:

- **At most one per template.** Once a template has one, End Shift is no
  longer offered in the add-item menu.
- **Always last.** It is added as the final item of the template's last
  section, and stays there: it has no drag handle, nothing can be dropped
  after it, and its section cannot be dragged above another. Duplicate is
  not offered for it.
- **Only in a section made with the checklist.** The last section's trigger
  must be Always (with the checklist). A section created later by a scan or a
  visit might never exist on a given night, and the item with it. If the last
  section has any other trigger, End Shift is offered disabled, with the
  reason.
- **Never on a Clock Out template.** That template *is* the End of Shift
  Checklist; finishing it already carries on to the end of the shift. End
  Shift is not offered on a Clock Out template, and Clock Out is offered
  disabled, with the reason, on a template that has one.

The rules live in the editor because a template can't be saved in a state
that breaks them, and nothing else writes templates. A device reading an old
template that somehow breaks them still behaves: the Active Checklist only
ever acts on an End Shift Item when it is tapped, wherever it sits.

## Item versions

An instance item points at the exact template-item row it was created from,
and reads its label, type and config through that row. Editing a template
never edits that row:

- **Edit a referenced item.** Write a new row (version + 1, with
  `previous_version_id` pointing at the old one) and orphan the old row
  (`section_id` null). The `previous_version_id` chain is how Update open
  checklists finds an item's current version.
- **Edit an unreferenced item.** Replace the row with a new one. The new row
  takes the old row's `previous_version_id` and `version`, so the chain does
  not break.
- **Remove an item.** Orphan it if it is referenced, and delete it otherwise.

"Referenced" is decided by the device, which only holds checklists from the
last 30 days and every open one. An item that only an older, completed
checklist uses therefore looks unreferenced, and the device deletes it.
**Postgres decides the case the device cannot see.** A `BEFORE DELETE`
trigger on `checklist_template_items` turns the delete of a referenced row
into an orphan (`section_id` set to null) and skips the delete. Before this
existed, the delete was refused with a foreign-key error (23503) and the
connector discarded it. The old row then synced back into the template beside
its replacement: an edit duplicated the item, and a removal was undone.

## Update open checklists

Editing a template does not change checklists already generated from it.
Instead, the builder offers one action that applies every change made so far,
however many there were, to the template's open checklists:

> **3 open checklists differ from this template.** [Update them]

- **Who sees it.** The banner appears on an expanded template card when at
  least one open checklist (`not_started` or `in_progress`, including nested
  location-check checklists) would change. The count is of checklists, not of
  changes. Nothing is asked while editing, so a run of twenty edits produces
  one banner and one click.
- **What it compares.** Each open checklist is planned against what the
  template would produce for it now. If nothing would change, there is no
  banner, so making an edit and reverting it leaves no banner behind.
- **Applying.** Update writes every open checklist in one transaction. It
  logs one `checklist.updated` activity entry per checklist it changed,
  naming the template, and shows "Updated N checklists". The banner then
  clears because the plans are now empty.
- **Clicking it mid-edit.** Clicking Update blurs whatever label is being
  edited, which commits it. Update waits for every template write the page
  has started before it plans, so it never sees an edit half-way through
  (new row written, old row not yet removed).

Rules, applied to each open checklist:

1. **Answered items are never touched.** An item counts as answered if it has
   a `completed_at`, a `result` (a location-check item that has started its
   nested checklist has a result and no `completed_at`) or a `note`. It keeps
   pointing at the version it was answered against, even if that item was
   since edited, removed, or its section deleted.
2. **An edited item** is repointed to its current version (following
   `previous_version_id` through any number of edits) if it is unanswered.
   The row keeps its id and its position.
3. **An added item** is inserted into sections the checklist already has,
   with the deterministic id `institem:<section>:<item>` and the template's
   position.
4. **A removed item** is deleted if it is unanswered.
5. **Item order is not copied.** Guards can reorder items on their own
   checklist, and a template reorder does not overwrite that.
6. **An existing section** takes the template section's current name,
   position and location.
7. **A new or reactivated section** is added if it is the kind created with
   the checklist (Always, Recurring, Location status) and is eligible under
   the same rule as creation. For that rule, recurrence is checked against
   the day the checklist was created. Location status is checked against the
   location's status now, so a slip that has since become occupied can also
   bring its section in. Sections triggered by an event (checkpoint, location,
   asset) are still added when the event happens.
8. **A deleted or deactivated section** is removed if none of its items are
   answered. Otherwise it stays as it is.
9. **Hide until and Due by** are recomputed only for a checklist or section
   that is **still hidden** (`hide_until` in the future). Anything already
   visible keeps its times, because once visible, nothing re-hides. The rules
   resolve exactly as they did at creation: from the checklist's
   `expected_start_at` anchor if it has one, otherwise from the row's
   `created_at`. A row created before `created_at` existed has it null. For
   those rows, Hide until resolves from now, which gives the same answer for
   anything still hidden, and Due by is left alone.
10. **Assignment, trigger, viewer roles and the template's name** are never
    applied to an existing checklist. To get a checklist under new
    assignment, launch one manually.

Two consequences of rules 1 and 4, both accepted:

- A guard who answers an item **offline** while Update repoints it uploads an
  answer that now reads through the new wording.
- A guard who answers an item offline while Update **removes** it loses that
  answer. The upload targets a row that no longer exists.

## States & edge cases

- **Template with no assigned role.** Flagged in the builder. Until a role is
  set, its instances fall back to whoever triggers them. A template has no
  role when it is new, and again when its role is deleted: the template is
  kept, not deleted with the role, so it can be given another one.
- **Deleting a template with open checklists.** Those checklists are
  unaffected and render through the kept item rows. Only future triggers stop.
  There is no banner, because there is no template left to compare against.
- **Checkpoint Visit trigger with no checkpoints on any section.** Shown
  plainly. The template never generates a checklist until a section names a
  checkpoint.
- **Asset sections.** Configurable now, but no runtime event creates them
  yet. The builder says so.
