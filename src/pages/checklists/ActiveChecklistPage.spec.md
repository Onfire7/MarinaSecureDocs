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
| Fleet Vehicle | See [Fleet Vehicle Item](#fleet-vehicle-item). One of three modes, set in the template: Take a Vehicle, Status Check, Return Your Vehicle. | Written **at once**, not deferred to submit: a check-out, a check-in, or a Status Check's readings. |

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

## Fleet Vehicle Item

A Fleet Vehicle Item ties a guard's use of a Fleet Vehicle to their
checklist, and so to their Shift. It works on the same vehicles, records and
tiles as the Fleet card (`src/pages/home/FleetCard.spec.md`); a guard can use
either, and each sees what the other did. The design was settled by a
throwaway prototype, Variant D on the `prototype/fleet-checklist-items`
branch.

**Always optional.** Every mode has an answer that means "no vehicle", and it
is a real answer, not a skip: the usual vehicle may be out of service, or a
small marina may not use one every night but still wants it recorded when it
does. No mode needs `use_fleet`: the template assigning the item is the
authorization, as for every other item type.

**The board.** Wherever an item asks the guard to choose a vehicle, it shows
the Fleet card's board, so each vehicle's state is visible before choosing:
one tile per Fleet Vehicle, two to a row, with name, status line
("Available", "With {name}", "Out of service"), odometer and fuel gauge,
ordered as on the card. Only tiles the mode can act on are tappable; the rest
are dimmed. Tapping one widens it across the board and opens the mode's form
inside it; tapping it again, or Cancel, closes it. A vehicle the guard holds
is shown as the card's wide **With you** tile instead, with the form inside.

### Take a Vehicle

| Guard holds | The item shows | Answers with |
|---|---|---|
| Nothing | The board; available vehicles are tappable. The opened tile asks for the starting odometer (prefilled) and offers **Check out {vehicle}**. **No vehicle this shift** sits under the board. | The checkout it made, or "No vehicle this shift". |
| A vehicle | Answered: "{vehicle} · checked out {time}", and the vehicle's wide tile. | That checkout, wherever it was made: the Fleet card, Asset Detail, or a checkout kept from an earlier Shift. Nothing is entered twice. |

Checking out writes exactly what the Fleet card's Check out writes, to the
guard, at once (§ Deferred side effects explains why this is the exception).

### Status Check

Records a vehicle's odometer and fuel level mid-shift, with a fill-up if
there was one, without checking anything in or out.

- **Holding a vehicle:** its wide tile, holding the form.
- **Holding nothing:** the board, with available vehicles tappable, so a cart
  nobody took can still be checked; and **No vehicle this shift**.
- **The form:** odometer (prefilled with the current reading; below it needs
  a correction reason, as everywhere), fuel level (five buttons, required),
  and **⛽ Add fuel**, which opens gallons (required, > 0) and cost
  (optional). Entering gallons sets the fuel level to F; the guard can change
  it if they didn't fill the tank. **Record** answers the item.
- **Written at once.** Record writes, in one transaction, a Meter Reading if
  the odometer changed and one `asset_fuel_logs` row carrying the level and,
  for a fill-up, gallons and cost. Maintenance rules are evaluated then, as
  for any Meter Reading. Unlike a Meter Reading item it is not deferred to
  submit, so a supervisor reading the Shift Report mid-shift, and the next
  guard looking at the Fleet card, see the vehicle as it is now.

### Return Your Vehicle

| Guard holds | The item shows | Answers with |
|---|---|---|
| A vehicle | Its wide tile with the Fleet card's check-in form: ending odometer with "+{n} this trip", fuel level (required), "Anything to report?" (optional), **Check in**. | The check-in. |
| Nothing, but checked one in this Shift (from the card, say) | Answered: "{vehicle} · checked in {time}". | That check-in. |
| Nothing at all | Answered: "Nothing to return". | Itself. It has no Edit; there is nothing to undo. |

Two vehicles held at once: Return shows the one with the earliest checkout
first, and is answered once both are back.

### Answered by circumstance

Take with a vehicle already in hand, and Return with nothing to return or a
check-in made elsewhere, are **answered by circumstance**: shown and counted
as answered, and their result is written when the checklist is submitted,
recording the circumstance at that moment. Nothing is written just because an
item rendered.

### Edit undoes what the item did

Edit on an answered Fleet Vehicle Item reverses its effect, because a
check-out or check-in has already happened for everyone else:

| Answered with | Edit |
|---|---|
| A checkout (made by this item or answered by circumstance) | Asks: "Undo checkout of {vehicle}? {vehicle} goes back to Available and this item reopens." **Undo checkout** deletes the checkout and the Meter Reading it wrote, puts the vehicle's reading back, and removes any section or checklist its trigger added that has nothing answered yet (§ Asset triggers in the template editor's spec). An activity log entry records who undid it. |
| A check-in | Asks: "Undo check-in of {vehicle}? {vehicle} is with you again and this item reopens." **Undo check-in** reopens the checkout (clears `time_in`, `odometer_in`, `fuel_level_in`, `return_note`), deletes the post-return status entry and Meter Reading the check-in wrote, and removes unanswered triggered work, as above. Logged likewise. |
| A Status Check | Withdraws what it wrote (deletes its fuel log row and its Meter Reading, putting the vehicle's reading back) and reopens the form with its odometer, fuel level and fill-up filled in. No confirmation: nothing is lost, the guard re-records. If a later reading has landed on the vehicle since, its reading is left alone; only this item's rows go. |
| "No vehicle this shift" | Reopens. |

Refused, with the reason and an **OK**, rather than undone:

- Undoing a checkout while this checklist's Return item holds its check-in:
  "Undo the Return item first: this vehicle has been checked back in."
- Undoing a check-in after the vehicle has been checked out again, by anyone:
  "{vehicle} has been checked out again since, so this check-in can't be
  undone here."

Maintenance Tickets a reading has already raised are not withdrawn by an
undo; they are real work, and closing one is a ticket action. Once the
checklist is submitted, its Fleet Vehicle Items are read-only like every
other item, and a mistaken checkout is fixed on Asset Detail.

A checkout kept from an earlier Shift answers the next Take item by
circumstance, like any vehicle already in hand.

### Results

| Mode | `result` |
|---|---|
| Take | `{type: "fleet_vehicle", mode: "take", checkoutId}` or `{…, none: true}` |
| Status Check | `{…, mode: "status", assetId, odometer, fuelLevel, fill?: {gallons, cost?}, fuelLogId, meterReadingId?, previousReading?}`, naming the rows it wrote and the reading it replaced, so Edit can withdraw exactly those; or `{…, none: true}` |
| Return | `{…, mode: "return", checkoutId}` or `{…, nothing: true}` |

### Data changes

One migration, then `pnpm run schema:gen`. All additive.

- `checklist_item_type` gains `fleet_vehicle`; `template_trigger` gains
  `asset`. (`section_trigger` already has `asset`; the event lives in
  `trigger_config`.)
- `asset_fuel_logs.gallons` becomes nullable, and gains `level smallint`
  (0–4, checked), with a check that a row has gallons or a level. Existing
  rows are fill-ups with no level, which still read as F.
- `asset_checkouts.kept_after_shift boolean not null default false`: set on
  the checkout that a Kept Vehicle continues on. No new table, and no sync
  rule change: both tables already sync with `SELECT *`.
- `docs/data-model.md` and `CONTEXT.md` (Fleet Vehicle Item, Status Check,
  Kept Vehicle; Fuel Log widened) follow.

The migration goes to the marina's database **before** the client deploys:
a write to a column Postgres lacks is retried forever and blocks every later
write on that phone (`docs/TODO.md` § Localization records the same trap).

### Copy

All new copy, in these pages and the data modules' activity summaries,
goes through the catalogs (`docs/localization.md`): UI text with `t()` in a
new `checklists` namespace (plus `home` and `reports` for the End of Shift
step and the report section), activity summaries with `dataT`, numbers and
times through `src/i18n`'s formatters. The rest of each area stays as it is
until that area's own conversion commit (`docs/TODO.md` § Localization).

## Ending the shift

The end of a shift always runs in the same order, whichever button starts it:
the **End of Shift Checklist** if one is due, then **Vehicles still out**, if
any, then the **End of Shift review**, which ends the shift.

1. **End of Shift Checklist.** When the guard's Role has a Clock Out template
   with something to do right now, and this Shift's End of Shift Checklist is
   not yet complete, the next step is that checklist: opened if it already
   exists, otherwise created, linked to the Shift
   (`shifts.end_of_shift_checklist_id`) and opened.
2. **Vehicles still out.** When the guard holds a checkout of a Fleet
   Vehicle that was not opened by keeping it during this Shift
   (`kept_after_shift` with a `time_out` inside the Shift), `/shift/end` first
   shows **Before you go**: "You still have {vehicle}", its wide tile, and
   two choices. One vehicle at a time, earliest checkout first.
   - **Check it in**: the Fleet card's check-in form.
   - **Keep it past my shift**: a reason (required), the odometer and the
     fuel level (both required). **Keep it and continue** writes, at once
     and in one transaction, a pair of checkout records, so the trip is cut
     at End of Shift the way a paper log would be:
     - the guard's checkout is **closed** with `time_in`, `odometer_in`,
       `fuel_level_in`, and the reason as its `return_note`, but with no
       post-return status entry, since the vehicle never came back;
     - a **new checkout** opens to the same person at the same moment, with
       `odometer_out` the same reading and `kept_after_shift = true`;
     - a Meter Reading if the odometer changed.

     The vehicle stays with the guard; the card shows it as theirs from the
     new checkout. Keeping fires no Asset trigger, since nothing was really
     checked out or in.

   Warned, never blocked: keeping a vehicle is legitimate, but its readings
   are taken either way. Vehicles a guard does not hold (checked out to
   someone else, or not checked out) never appear here.
3. **End of Shift review.** Otherwise the next step is the review, at
   `/shift/end`. It ends with **End Shift and Submit**, which sets
   `shifts.ended_at`. Nothing ends the shift before that button.

**Submitting an End of Shift Checklist no longer ends the shift.** It goes on
to the review instead. This replaces the old behaviour, where its submit set
`ended_at` in the same transaction.

Until the Shift Report exists (`docs/ROADMAP.md`; settled design in
`CONTEXT.md`), the review is a plain confirmation: the Shift's start time and
length, any of the guard's checklists from this Shift still open - "2
checklists are still open; anything recorded on them won't be saved unless
they're submitted", each a link to finish it - the Shift Report's
**Vehicles** section (`src/pages/reports/ShiftReportPage.spec.md`), and
**End Shift and Submit**.
When the Shift Report is built, the review becomes that report, with the
same button at its end.

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Complete an item | The checklist's `assigned_to`, or a holder of the template's assigned role; `viewer_roles` members get a read-only rendering | Per the item-type table; any order. |
| Reorder items within a section | Same as completing | Toggles the section into a compact reorder list (↑/↓ per row) and writes the rows' own order, kept as the guard's working order. Presentation, not meaning: nothing is versioned. An End Shift Item is not reorderable. |
| Collapse / expand a section | Only when more than one section heading shows (not in a single-section embed) | A chevron beside the section name. Finished sections start collapsed, the rest expanded, until the guard chooses. Nothing is written. |
| Collapse / expand all sections | Same as above | Stacked chevrons in front of the title. If any section is expanded it collapses all; otherwise it expands all (label and `aria-expanded` follow). Overrides each section's state, including finished ones; sections can still be toggled singly afterward. Nothing is written. |
| Edit a completed item | Same as completing, and only while the checklist is unsubmitted | Reopens the item prefilled with what was recorded, so a correction is an adjustment. Safe because nothing it raised has been written yet. Fleet Vehicle Items that checked a vehicle out or in undo it instead (§ Fleet Vehicle Item). Once submitted, items are read-only. |
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

**Fleet Vehicle Items are the exception.** They write at once. Take and
Return are not findings about the world but a change to it: the moment a
guard takes the truck, everyone else's Fleet card must show it gone. A
Status Check is a finding, but one a supervisor reading the Shift Report
mid-shift should see as it happens. That is why Edit on a Fleet Vehicle Item
*undoes* rather than merely reopens (§ Fleet Vehicle Item).

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
