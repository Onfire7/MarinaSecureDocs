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
| Trigger | `trigger_type` / `trigger_config` | Manual, Clock In/Out, Checkpoint Visit, Asset Check Out/In, or Recurring. Recurring takes an RRULE day rule (days only; the time of day belongs to Hide until). A Checkpoint Visit template is triggered through the checkpoints named on its sections, and an Asset Check Out/In template through the assets on its sections (§ Asset triggers). |
| Expected start, Hide until, Due by | `expected_start` / `hide_until_rule` / `due_by` | Authored rules. They are resolved to concrete timestamps on each instance when it is created, and exist on the template and on every section. |
| Sections | `checklist_template_sections`, ordered | Each has a name, an active toggle, its own trigger (Always, Recurring days, Checkpoint scan, Location visit, Asset checked out, Asset checked in, Location status), one location, checkpoints in that location, assets, its time rules, and its ordered items. |

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
- **Copy a section to locations.** One section per chosen location, modelled
  on the one you built. See below.

## Copy a section to locations

A section is almost always "the round you do at a place", and a marina has
many places that get the same round: every slip on a dock, every boathouse,
every gate. Building that round once and copying it is the only way to set
up forty of them, so an open section offers **Copy to locations…** beside
Delete, as an icon button (⧉, the same glyph as Duplicate) so the name field
keeps its width. The source section is the pattern: whatever it asks, wherever it is,
is what each copy asks at its own place.

### The dialog

- **Which locations.** A parent picker ("Under") and a location-type filter
  narrow a checkbox list of candidates: the descendants of the parent, of
  that type, each shown with its ancestor path. Neither filter is required:
  with no parent, the list is every location. "Select all" ticks the list as
  filtered. The source's own location is never offered, and a location that
  already has a section in this template is shown ticked and disabled with
  "already in this template", so running the copy twice adds nothing.
- **Checkpoints**, one of three:
  - **Attach every checkpoint at the location.** Whatever checkpoints exist
    at each target, all of them.
  - **Create matching checkpoints.** For each checkpoint attached to the
    source section, a checkpoint at the target named by the substitution rule
    below, with a fresh GUID (a new tag to write) and the source's GPS
    validation radius, and no GPS fix, since that was the source's place.
    If the target already has a checkpoint of that name, it is attached
    instead of created again. Disabled, with the reason, when the source has
    no checkpoints.
  - **None.** Attach by hand later.
- **Add N sections** writes everything in one transaction. Nothing is
  written until then; Cancel writes nothing.

### What each copy gets

- **Name, item labels and created checkpoint names** follow the
  **substitution rule**: the source location's name is searched for in the
  text, case-insensitively, and every occurrence is replaced with the
  target's name. If it is not found, the target's name is appended after a
  space. "Dock A walk" copied to Dock B becomes "Dock B walk"; "Door check"
  becomes "Door check Dock B". A source with no location has nothing to
  search for, so its names are always appended to.
- **Location** is the target. Trigger, trigger config, Hide until, Due by
  and the active flag are copied from the source.
- **Items** are fresh version-1 rows, in the source's order, as Duplicate
  template makes them. A Door Check or Lock Check whose `config.locationId`
  is the source's location is repointed to the target; one pointing anywhere
  else keeps it. An End Shift Item is never copied, because the template may
  hold only one.
- **Assets** are attached as on the source. An asset is a thing, not a
  place, so it is the same asset everywhere.
- **Position** is directly after the source, in the order the list showed
  the targets, and the sections that followed the source move down. The
  copies arrive collapsed; the source stays as it was.

Open checklists see the copies through **Update open checklists**, under its
rule 7, like any other new section. Nothing in the copy touches an instance.

The plan — which rows, with what names, pointing where — is pure and lives
in `src/lib/sectionCopy.ts`; `src/data/checklists.ts` only executes it.

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

## Fleet Vehicle Items

A Fleet Vehicle Item (`src/pages/checklists/ActiveChecklistPage.spec.md`
§ Fleet Vehicle Item) has one setting, its **mode**, stored as
`config.mode`:

| Mode | `config.mode` | Default label |
|---|---|---|
| Take a Vehicle | `take` | Take a vehicle |
| Status Check | `status` | Vehicle status check |
| Return Your Vehicle | `return` | Return your vehicle |

The mode is chosen from three buttons in the item's settings, and changing it
is an ordinary config edit (a new version if the item is referenced). A
template may hold any number of Fleet Vehicle Items, in any modes and
sections: a Clock In checklist with Take, a midnight section with Status
Check, an End of Shift Checklist with Return. Nothing about which vehicle is
configured: the guard chooses from the board, because which vehicle is free
is only known on the night.

## Asset triggers

Checking an Asset out or in is an event a checklist can respond to, as a
checkpoint scan is. It fires wherever the checkout happens: the Fleet card, a
Fleet Vehicle Item, or Asset Detail's Checkout / Return. Keeping a vehicle
past End of Shift fires nothing, since nothing was checked out or in.

- **Section triggers.** A section's trigger is **Asset checked out** or
  **Asset checked in** (`trigger_type = 'asset'`, `trigger_config.event` =
  `check_out` / `check_in`), with the assets it watches attached below it.
  A section saved before this change, with no event, is treated as
  **Asset checked out**.
- **Template trigger.** **Asset Check Out/In** (`trigger_type = 'asset'`),
  triggered through the assets on its sections, like Checkpoint Visit.
- **Who gets it: the person now holding the asset**, for both events: the
  marina user whose `contact_id` is the checkout's person, whoever pressed
  the button. A manager checking the truck out to a guard from Asset Detail
  sends the work to the guard. A checkout to someone with no user account (a
  guest, from Asset Detail) fires nothing.
- **What it adds.** For each active section watching this asset for this
  event: if the holder has an open checklist from that template, the section
  is added to it (once; a second checkout adds nothing new). Otherwise, if
  the template's own trigger is Asset Check Out/In and it is eligible today,
  a new checklist is created for the holder holding just the triggered
  sections, as a checkpoint scan does. Ids are derived from the checkout and
  the event, so a replayed write queue converges rather than duplicating.
- **In the same transaction** as the checkout or check-in, with a
  `checklist.created` activity entry naming the vehicle, so a checkout is
  never recorded without its work.
- **Undo.** Undoing a checkout or check-in from a Fleet Vehicle Item removes
  the sections and checklists that event added, if nothing in them has been
  answered. Answered work stays.

The builder's section editor shows the event as two trigger choices and lists
the attached assets, as today. Its old note, "Nothing creates asset sections
automatically yet", goes.

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
- **Asset Check Out/In template with no assets on any section.** Shown
  plainly, as for Checkpoint Visit. It never generates a checklist until a
  section names an asset.
