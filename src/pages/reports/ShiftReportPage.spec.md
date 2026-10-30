# Shift Report

The record of one guard's Shift, read by their supervisor and, when
something notable happened, by other guards. One document, three places:

| Where | Route | Who | What it shows |
|---|---|---|---|
| **The End of Shift review** | `/shift/end` | The guard, on shift | The report compiled live from the device, with the End of Shift Note to write and **End Shift and Submit** at the end. |
| **In the app** | `/reports/shifts/:id` | The shift's guard, or `view_reports` | The snapshot once the shift has ended; live, with a banner, before. Names link to their records. |
| **The Report Link** | `/r/shift/:id` | Anyone holding the URL | The snapshot, with no shell, sign-in or local database. |

Settled by prototype: Variant D on `prototype/shift-report` (2026-10-20,
owner's combination), with Vehicles added 2026-10-21. Vocabulary is in
`CONTEXT.md` (Shift Report, End of Shift, End of Shift Note, Report Link,
Ticket Update, Incident Update). ADR 0008 records why the updates beneath
incidents and tickets exist.

## The body is fixed at End of Shift

The report's body is compiled **on the guard's device** when they tap End
Shift and Submit, and stored as a snapshot (`shift_report_snapshots`, one
row per shift, the document as jsonb) in the same transaction that sets
`shifts.ended_at`. The device is the only place that is guaranteed to hold
everything the guard recorded, including what hasn't uploaded yet. From
then on every view, in-app or public, renders that snapshot verbatim: the
paper report as handed in. It is never reopened or recompiled.

What changes afterwards appears **beneath** the incidents and tickets it
concerns, read live: Addenda and Incident Updates made after `ended_at`,
and Ticket Updates made after `ended_at`. The body never moves.

**Before End of Shift**, the in-app page and the review compile the report
live from the device, headed by a banner: *This shift hasn't ended yet.
The report may be incomplete.* The public page shows only the header and
that sentence, because a public viewer has no device data and the server
does not compile reports; the snapshot appears there once it syncs. A
supervisor who needs the mid-shift picture uses the in-app page.

## Who it is about

Only this guard's own activity: their check-ins, their checklists, the
Incidents they authored, the Tickets they created, the Notes they wrote,
their Fleet Vehicle use. Another guard on an overlapping shift has their own
report. Association is by timestamp inside the shift's window and by the
guard's id, never by a link to the shift (`docs/data-model.md` § Shift).

## The document

In this order. Each section's rules follow.

1. **Header.** Marina name; the guard; start and end, duration; *Ended by
   {End of Shift Checklist name}* or *Ended by End Shift*; End of Shift
   time.
2. **End of Shift Note.** The guard's own words, verbatim, when they wrote
   any. Omitted when empty.
3. **Summary.** Sentences, not numbers, from a pure function the email
   reuses (§ The email): checklists complete of total; incidents logged
   and tickets raised; one sentence per vehicle driven ("{guard} drove the
   {vehicle} 33 miles and returned it at 1/4 tank", or "still has it" /
   "kept it past End of Shift"; *miles* or *hours* by the vehicle's meter,
   pluralised by the distance, each a whole sentence in the catalog); "{n}
   things need attention."
4. **Needs attention.** One line per item, never truncated, in time order,
   each with where it happened and when. What qualifies:
   - an Incident logged (every one; "bad" when its status is still open at
     End of Shift, else "warn");
   - a Door or Lock Check found other than expected;
   - a rejected Verify Task;
   - a Manual Check-In, with its reason;
   - a check-in outside the checkpoint's GPS radius;
   - a checklist unfinished at End of Shift: name, done of total, due time
     if it had one;
   - a vehicle kept past End of Shift, with its reason; a vehicle set Out of
     Service; a return note; a vehicle returned at ¼ tank or below.
5. **Incidents.** Each in full: title, type, target, time, status at End of
   Shift, details. Beneath, *Since End of Shift*: Addenda and Incident
   Updates after `ended_at`, by time, leading with *Now {status} (was
   {status})* when the status moved; *No changes. Still {status}.* when
   none. Gated by `view_incidents` in the app; the public page shows them
   (the report goes to the guard's supervisor by design, § Report Link).
6. **Tickets raised.** Each: title, priority, target, time, origin (the
   `created` Ticket Update's origin), status and assignee at End of Shift,
   description. Beneath, *Since End of Shift*: Ticket Updates after
   `ended_at`, the same way. **Open first**: tickets whose status was not
   terminal at End of Shift, then the closed ones; within each, by the
   marina's status order, then by time. Each card has a coloured top edge,
   as the Location cards do: orange while open, green once closed.
   Reports stored before 2026-10-30 keep their order and have no edge.
7. **Notes.** The guard's Notes in the window: target, time, body.
8. **Vehicles.** The existing section, unchanged in content
   (`VehicleUseSection`; rules below under § Vehicles).
9. **Locations.** One card per Location that had any of this guard's
   work, **worst first**: cards with a miss, then cards with an exception,
   then cards where all was as expected; inside each group, tree order
   (parent before child, siblings by name). Under each: the check-ins made
   there and the checklist items whose section is bound there, **as one
   list of items**, in time order, each with its result and time, misses
   and exceptions marked. Check-ins read as items: *Check-in ·
   {checkpoint}: Scanned 10:31 PM* / *Manual, "tag cracked"*. Routine items
   are folded behind the card's **Show {n} more**; the card's edge is
   coloured by the worst thing in it, and its header gives the number of
   check-ins, misses and exceptions, and the first and last time anything
   was recorded there. Items from sections with no Location go under a
   final card named for their checklist.

**Photos.** Incidents and Tickets carry no attachments yet. When they do,
each appears inline under its record, by the attachment's public URL; the
document already has a `photos` array per record, empty for now
(`docs/ROADMAP.md`).

**Left out, on purpose.** Calls and SMS, asset checkouts that are not Fleet
Vehicles, Reservations, Activity Log entries, other guards' records.

### Which checklists belong to the shift

A checklist belongs to the shift when any of its items was answered in the
window, or was expected to be: it was created in the window, or one of its
sections came due in it. In the report it shows only that shift's items;
the rest are summarized as *{n} items done in the previous shift*. Items
still open at End of Shift count as missed in this shift.

### Check-ins are left out, for now

Owner's call, 2026-10-30: the report shows no check-ins at all — no
check-in items in the Location cards, no check-in count, no Manual or
outside-radius attention lines, and the summary does not count them.
Everything below about check-ins describes what the compiler does when it
is given them; `useShiftReportInputs` passes it none. Reports stored before
this change keep the check-ins they were compiled with.

### Checkpoints are never "missed"

The report records the check-ins the guard made and nothing about the ones
they didn't. Settled with the owner 2026-10-21: some checkpoints exist for
convenience and are not required on every shift, and a checkpoint whose
tag has not been deployed yet would read as missed on a night the guard
demonstrably visited the place. Which checkpoints a shift *requires* is
the Checkpoint reporting work on the ROADMAP, with the Tour rethink; until
then a missed visit is only visible as an unfinished checklist item.

### Vehicles

As specified for the interim section, now part of the fixed body: every
checkout overlapping the window whose person is the guard's Contact; fuel
logs, status logs, standalone readings, and Incidents and Tickets the guard
raised on a Fleet Vehicle in the window; kept vehicles read as kept, not
returned. Compiled by `compileVehicleUse()`.

## The Report Link

`/r/shift/<shiftId>` on the deployment's public address (`publicOrigin()`,
from `VITE_PUBLIC_URL`; never `window.location.origin`, for the reason
`canonicalTarget()` gives). One permanent URL per shift; the shift id is an
unguessable UUID and is the whole credential for now. **Public**: the
supervisors it goes to do not have accounts yet. When they do, the same URL
asks for sign-in (`docs/ROADMAP.md` § Report Links require sign-in).

The page is routed in `App.tsx`'s public branch, before the signed-in
chunk is requested, and reads through `src/data/sharedShiftReport.ts`, an
anon-key client that imports nothing from `src/lib/db` (the same rule as
`sharedReport.ts`; the e2e test asserts on request URLs). One RPC,
`shift_report(p_shift uuid)`, security definer, executable by `anon`:
returns `{ status: "ended", document, updates }` when a snapshot exists,
`{ status: "not_ended", header }` when the shift exists but has not ended,
and null for an unknown id, which renders as one neutral page.

`updates` is what moved since `ended_at`, gathered by the RPC from
`incident_comments`, `incident_updates` and `ticket_updates` for the ids the
document names, so the public page needs nothing else.

## The in-app page

`/reports/shifts/:id`, for the shift's guard or `view_reports`. Renders the
same document through the same component; differences: it sits in the
shell, record names link to their pages, and before End of Shift it
compiles live from the device (the device of a supervisor holds the guard's
rows: check-ins, checklists, incidents, tickets, shifts all sync marina-wide
within their windows). Reached from Reports home's shift list.

**Email report** replaces Resend: it opens the dialog (§ The email). The
unbuilt send function is no longer called from anywhere.

## The End of Shift review

`/shift/end` is this report, compiled live, with two additions: the **End of
Shift Note** box after the header (*Anything your supervisor should know?*,
optional), and **End Shift and Submit** at the end. *Before you go* (a
vehicle still out) still comes first, as `ActiveChecklistPage.spec.md`
§ Ending the shift says. The *Needs attention* lines link to where each can
be fixed: an unfinished checklist opens it; a missed check-in opens the
checklist section that expected it. Nothing blocks submitting; no reason is
required for anything.

**End Shift and Submit**, in one transaction: compile the document with the
note, insert the snapshot, set `shifts.ended_at`, write the Activity Log
entry. Then open the email dialog. If the device is offline the snapshot
uploads with everything else; the dialog says so (§ The email).

## The email

A pure function, `shiftReportEmail(document, link)`, gives:

- **Subject**: *Shift report: {guard}, {day}, {start}–{end}*.
- **Body**, plain text: the summary sentences; the End of Shift Note,
  quoted, if any; every *Needs attention* line, unlimited; a blank line; the
  Report Link; one line saying who to ask if the link doesn't open. No
  greeting or sign-off, so whoever pastes it adds their own.

The **dialog** (`ShiftReportEmailDialog`) shows the subject, the body and the
link, each with its own Copy button, plus **Copy all** and an *Open in mail*
`mailto:` link (a convenience; long bodies get cut by some mail clients).
Copy uses the clipboard API and says *Copied* for two seconds. When the
snapshot row has not uploaded yet, a line under the link reads *Saved on
this device; the link will work once you're back online.* (read from the
PowerSync upload queue's state, as the sidenav's *All changes sent* is).

Available to the shift's guard and to `view_reports` holders, from the
review's End Shift and Submit and from the in-app page's **Email report**.
The sentences are the same pure function the automatic email will use
(`docs/ROADMAP.md` § Shift Reports: automatic email).

## Data changes

One migration, then `schema.ts` by hand (`document` joins
`STRUCTURED_COLUMNS`). All additive.

- `shift_report_snapshots`: `shift_id uuid primary key references shifts
  on delete cascade`, `document jsonb not null`, `created_at`, `is_recent`
  (from the shift, in `refresh_child_sync_scopes()`). Tier 0, **insert
  only**: the body is never rewritten. Joins the `work` sync stream.
- `shift_report(p_shift uuid) returns jsonb`, security definer, `anon` and
  `authenticated` may execute; as above.
- `docs/data-model.md` § Shifts follows.

## Copy

All new copy in the `reports` namespace, through `t()`; the public page uses
the device's language (`docs/localization.md` § Public pages). The summary
sentences and the email are built from the catalog too, in the viewer's
language; the snapshot stores facts, never sentences, so a Spanish-speaking
supervisor reads a Spanish report of the same shift. Times in the report are
the marina's local time.

## States and edge cases

- **Opened mid-shift, in the app.** Live, with the banner. Every open
  recompiles.
- **Opened before the snapshot has synced, publicly.** The header and *This
  shift hasn't ended yet*, since the server cannot tell "not ended" from
  "ended on a device that is still offline". Once the row lands, the report.
- **Shift ended some other way** (an admin closing a shift, a row with
  `ended_at` and no snapshot). The in-app page compiles live from whatever
  the device holds, with a banner *No report was handed in for this shift*;
  the public page says the same. Nothing is ever compiled on the server.
- **A guard with no linked Contact.** Vehicles shows only fuel and status
  records, as before.
- **Two shifts by the same guard overlapping** (a shift never ended). Each
  compiles over its own window; a record can appear in both. The Shift
  Schedule work on the ROADMAP is what prevents it.
- **The dialog on a device with no clipboard API** (an old WebView). The
  text is selectable; Copy is hidden.

## Mobile and desktop

The report reads at any width: the audit report's tokens and layout rules,
Variant D's card grids for Vehicles and Locations, two columns on desktop
for incidents' "since" panels, one on a phone. Print is always light and
drops every control.
