# Active Checklist

`/checklists/:id`. Item-by-item completion of a Checklist that is Not Started
or In Progress. The most interaction-heavy screen in the app, since it hosts
every item type.

Reached from the Checklist list, a checkpoint scan or manual check-in, a
Location-Based Check item opening a nested checklist, or the Shift card's
end-of-shift button (`src/pages/home/DashboardPage.spec.md`).

## How it renders

A checklist is fully materialized rows: every section and every item exists
in the database from the moment it was assigned. The page renders exactly
what is stored, grouped by section, and records a result per item row,
locally first. Nothing here needs connectivity.

- **Hidden sections.** A section still inside its `hide_until` is filtered out
  until its moment arrives, and a footnote says when the next one unlocks.
  Once visible, a section never re-hides.
- **Any order.** Items can be completed in whichever order suits the guard,
  and reordered to match: a per-section Reorder control rewrites the rows'
  own order, which is what always sorts.
- **When, not just whether.** Completing an item stamps `completed_at` and
  `completed_by` on its row, so an hour-long checklist records when each thing
  happened, not only that it all happened by submission.
- **Location headings.** When a section's items are bound to a Location other
  than the section's own, a small heading names that Location above the first
  item of each run of consecutive items bound there. A heading is always
  followed by its items, never stacked with another heading. A walk that
  returns to a Location after visiting another gets a second heading: the walk
  order is the source of truth and is not regrouped. Derived at render;
  nothing stored.

## Item types

| Type | Interaction | Writes |
|---|---|---|
| Simple Check | Tap to mark complete. | `result = true`; `completed_at` set. |
| Verify Task | Confirm done; reject with a written reason; or reject and raise a linked Ticket. If the template's config says so, a rejection first asks the guard to attempt the task themselves. | `result` = Confirmed / Rejected-Reason / Rejected-Ticket; `linked_ticket_id` set if a Ticket was raised. |
| Door Check, Lock Check | Two states are recorded: how it was found and how it was left. A door is Open, Unlocked or Locked (no "Closed": Unlocked and Locked both imply it); a Lock Check is Unlocked or Locked, for anything with a lock but no door. Found as expected is one tap, and the final state is implied. Found any other way raises an Incident (prefilled, editable) and asks what state it was left in; if that still isn't the expected state, the guard is offered a Ticket. The Incident attaches to the Location the template binds that door or lock to; the guard is never asked to pick a target mid-round. | `result` carries `initial_state` and `final_state`, plus the raised Incident; `linked_ticket_id` set if a Ticket was raised. |
| Location-Based Check | Opens a nested checklist scoped to one Location, and returns to the parent on completion. | A nested checklist, same schema, referenced from the parent item's `result`. |
| Meter Reading | Choose the Asset (fixed by the template, or picked at runtime, e.g. "your patrol vehicle") and enter its value. | On submit, an `asset_meter_readings` row and the Asset's current reading; maintenance rules are evaluated then, against the submitted value, and may raise Tickets. |
| Question | Answer in the shape the template set: a single line, repeatable lines, multiple lines, a number, or Yes / No (optionally asking for details on Yes, No or both). | `result` holds the answer. |
| End Shift | See [End Shift Item](#end-shift-item). | `result = true`; `completed_at` set; then the checklist is submitted. |

## End Shift Item

An End Shift Item lets a guard finish their Shift from inside an ordinary
checklist, so an evening checklist with work due "late, but well before
clock-out" can end the night without itself being a Clock Out checklist.

- **Always last.** It is the final item of the checklist (the template editor
  keeps it there - `src/pages/admin/AdminChecklistTemplatesPage.spec.md`). If
  its section is hidden until a time, the item is too, which is how a
  checklist says "not before 5 AM".
- **Tapping it submits this checklist.** Findings are only written on submit
  (§ Deferred side effects), so ending the shift with this checklist still
  open would lose them. The tap marks the item complete and submits the
  checklist. If other items are still unanswered, the guard gets the usual
  partial-submit confirmation first ("Submit anyway - 2 unanswered");
  backing out of it leaves the End Shift Item unanswered too.
- **Then it continues the end of the shift** exactly as the Shift card's
  button would in its current state - to the End of Shift Checklist, or to
  the End of Shift review (§ Ending the shift).
- **Not on shift.** When the person viewing has no active Shift, the item
  reads "You're not on shift" and does nothing. It counts as unanswered, so
  the checklist can still be submitted with "Submit anyway".
- **Viewers** (`viewer_roles`) see it read-only, like every other item.

## Ending the shift

The end of a shift always runs in the same order, whichever button starts it:
the **End of Shift Checklist** if one is due, then the **End of Shift review**,
which ends the shift.

1. **End of Shift Checklist.** When the guard's Role has a Clock Out template
   with something to do right now, and this Shift's End of Shift Checklist is
   not yet complete, the next step is that checklist: opened if it already
   exists, otherwise created, linked to the Shift
   (`shifts.end_of_shift_checklist_id`) and opened.
2. **End of Shift review.** Otherwise the next step is the review, at
   `/shift/end`. It ends with **End Shift and Submit**, which sets
   `shifts.ended_at`. Nothing ends the shift before that button.

**Submitting an End of Shift Checklist no longer ends the shift.** It goes on
to the review instead. This replaces the old behaviour, where its submit set
`ended_at` in the same transaction.

Until the Shift Report exists (`docs/ROADMAP.md`; settled design in
`CONTEXT.md`), the review is a plain confirmation: the Shift's start time and
length, any of the guard's checklists from this Shift still open - "2
checklists are still open; anything recorded on them won't be saved unless
they're submitted", each a link to finish it - and **End Shift and Submit**.
When the Shift Report is built, the review becomes that report, with the
same button at its end.

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Complete an item | The checklist's `assigned_to`, or a holder of the template's assigned role; `viewer_roles` members get a read-only rendering | Per the item-type table; any order. |
| Reorder items within a section | Same as completing | Toggles the section into a compact reorder list (↑/↓ per row) and writes the rows' own order, kept as the guard's working order. Presentation, not meaning: nothing is versioned. An End Shift Item is not reorderable. |
| Collapse / expand a section | Only when more than one section heading shows (not in a single-section embed) | A chevron beside the section name. Finished sections start collapsed, the rest expanded, until the guard chooses. Nothing is written. |
| Collapse / expand all sections | Same as above | Stacked chevrons in front of the title. If any section is expanded it collapses all; otherwise it expands all (label and `aria-expanded` follow). Overrides each section's state, including finished ones; sections can still be toggled singly afterward. Nothing is written. |
| Edit a completed item | Same as completing, and only while the checklist is unsubmitted | Reopens the item prefilled with what was recorded, so a correction is an adjustment. Safe because nothing it raised has been written yet. Once submitted, items are read-only. |
| Add a note | None | Opens the New note dialog, attached to the checklist's location context if one applies. |
| Log an incident | `create_incidents` | Opens the New incident form. |
| Submit the checklist | All items resolved, including items of sections still hidden: their work exists, it just hasn't shown yet. Otherwise "Submit anyway" after a confirmation. | Writes every deferred Incident, Ticket and meter reading, then sets `status = complete`, `completed_at = now`. A nested checklist's submit also stamps its spawning Location-Based Check item, so the parent's section time reflects when the nested one finished. An End of Shift Checklist goes on to the End of Shift review. |

## Deferred side effects

Incidents, Tickets and meter readings raised by an item are described as the
guard works and only written when the checklist is submitted. That is what
makes a completed item editable: reopening one rewrites its own result and
nothing else, because there is no Incident to retract, no Ticket to withdraw,
and no meter reading already applied.

Each carries the moment the guard recorded it, not the moment of submission:
a door found open at 02:10 and submitted at 05:45 is reported as found open
at 02:10. Ids are assigned when the finding is recorded, so an item's result
can reference its own effects before those rows exist, and re-submitting
cannot duplicate them. Meter-based maintenance rules are evaluated at submit
against the value actually submitted.

**A checklist left unsubmitted has raised nothing.** Its findings live only
on the checklist until it is submitted. This is why the End Shift Item
submits its checklist, and why the End of Shift review lists checklists
still open.

## States and edge cases

- **Offline throughout.** Every write is local-first; leaving and resuming,
  even after reconnecting, preserves exact progress.
- **Ticket from a failed item.** The Ticket's `source_incident_id` stays null;
  the item's `linked_ticket_id` connects it back.
- **Abandoned mid-checklist.** Status stays In Progress and it reappears on
  the Checklist list until finished. It raises no Incidents or Tickets until
  submitted.
- **Submit fails.** Shown on the page, not swallowed. The checklist stays In
  Progress so it can be retried; the deferred effects are written in the same
  transaction that completes it, so a failure leaves neither half applied.
- **End Shift Item, then the guard walks away.** The checklist is submitted
  whatever happens next. If the guard never reaches End Shift and Submit,
  the shift stays open, and the Shift card keeps offering the next step.

## Mobile and desktop

The full item list is visible at once on both, because items can be done in
any order and hiding all but "the next one" would get in the way. Mobile
stacks items in one column; desktop lays them out two-up.
