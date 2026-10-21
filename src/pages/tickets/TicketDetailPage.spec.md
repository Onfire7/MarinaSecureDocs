# Ticket Detail

`/tickets/:id`. One maintenance Ticket: what it is, where it stands, and
everything that has happened to it since, as a timeline.

Reached from the Ticket queue, an Incident's linked tickets, a checklist
item that raised it, the Shift Report, or any attachment target's ticket
list (Location, Boat, Asset, …).

## Ticket Updates

A Ticket's history is its own record, not the Activity Log's: the Activity
Log is purged on the marina's retention schedule, and a Ticket's history is
needed for as long as the Ticket is, by the Shift Report above all (the
report shows a Ticket as it was at End of Shift, with what changed since
beneath it). ADR 0008 records why the app writes the history rather than a
database trigger.

A **Ticket Update** (`CONTEXT.md`) is one row of `ticket_updates`:

| kind | from → to | Written when |
|---|---|---|
| `created` | — | The Ticket is created, by any path: the New Ticket form, a checklist's Verify Task or Door Check, a maintenance rule, an Audit Finding, a Boat haul-out. One per Ticket, always. |
| `status` | status name → status name | Status changes. `to` is the terminal status when the Ticket is resolved; a later change back is just another `status` row (what "reopened" means). |
| `priority` | priority → priority | Priority changes. |
| `assignee` | user name or null → user name | Taken or assigned. |
| `comment` | — | A comment is added. `body` holds it (markdown). |

Every row carries `created_at` (the device's clock at the moment of the
change, so an offline edit keeps its real time) and `author_id`. `from` and
`to` are the **names at the time** (status name, priority, user name), so
the timeline reads correctly when a status is later renamed or a user
deactivated.

Rows are **insert-only**. Nothing edits or deletes one, in the UI or the
database (RLS grants insert only). A mistaken comment is answered by another
comment.

**Written by the owning data module, in the same transaction as the change.**
Every write to `tickets` goes through `src/data/tickets.ts`: `createTicket`
and `insertTicket(tx, …)` for creation, `assignTicket`, `setTicketStatus`,
`setTicketPriority`, `addTicketComment`. The other modules that create
Tickets (`checklistSubmit.ts`, `assets.ts`, `boats.ts`) call `insertTicket`
inside their own transactions. A source-scan unit test asserts that no other
file writes to `tickets` or `ticket_updates`, which is where the guarantee
lives now that it is not in a trigger. The Activity Log entry each change
already wrote is still written; the two serve different readers.

## Data shown

| Field | Source | Notes |
|---|---|---|
| Title, description | `tickets.title` / `description` | Description is markdown, shown as plain text until a renderer lands. |
| Priority, status | `priority` / `status_id` | The status list is the marina's own; the Ticket's current status is listed even if since retired. |
| Created by, assigned to | `created_by_id` / `assigned_to_id` | |
| Attachment target | the six target columns | Links to the target's page. |
| Source incident | `source_incident_id` | Only with `view_incidents`; otherwise no trace. |
| Auto-generated | `auto_generated` | Shown with the maintenance rule that raised it, when known. |
| Timestamps | `created_at` / `resolved_at` | |
| **Timeline** | `ticket_updates`, oldest first | Every Update as one line: who, when, what. A `comment` shows its body; a `status`, `priority` or `assignee` row reads "Status Open → Resolved", "Priority Medium → High", "Assigned to Luis Ortega". `created` is the first line, "Created by {name}", with the raising rule or checklist item when it has one. |

The timeline is the page's second column on desktop and sits under the
fields on a phone, with the comment box at its end.

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Take | `assign_ticket_to_self`; only while unassigned | `assignee` Update. |
| Assign to someone | `assign_ticket_to_others`; whatever the current assignment | `assignee` Update. Reassignment is still an assignment. |
| Change status or priority | None | `status` / `priority` Update. Setting a terminal status stamps `resolved_at`; leaving one clears it, because the maintenance-rule baseline reads it. |
| **Comment** | None: the same gate as changing status, which is no gate. Tickets are the low-friction, everyone-can-touch-them record. | `comment` Update. Markdown, append-only. "Add a comment" under the timeline. |
| Add a note | None | Opens the Note dialog on the Ticket's attachment target; a Ticket carries no Notes of its own. |

A change that doesn't change anything (choosing the current status again) is
not written: no Update, no Activity Log entry.

## States and edge cases

- **No `view_incidents`, Ticket has a source incident.** Fully visible,
  with no sign it came from an incident.
- **Resolved Ticket.** Still editable; every later change is one more
  Update. Unlike an Incident, nothing locks.
- **Tickets from before Updates existed.** The marina had none in production
  use, and the table is not backfilled. A Ticket with no `created` row shows
  "Created by {name}" from the Ticket itself as its first line, so the page
  never reads as empty.
- **An Update whose `ticket_id` row is outside the device's window.** Updates
  take their `is_recent` from their Ticket, like comments from their
  Incident, so a Ticket and its history arrive and leave together.
- **Offline.** Every write is local-first, with the device's time.

## Mobile and desktop

Mobile: fields stack, the timeline follows, the comment box last. Desktop:
fields left, timeline right, both visible at once.
