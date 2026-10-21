# Incident Detail

`/incidents/:id`. Gated by `view_incidents`. One Incident: its original
content, and a timeline that never closes.

Reached from the Incident list, a linked Ticket (with `view_incidents`), a
checklist item that raised it, or the Shift Report.

## Two edit windows

The original content (title, type, details) belongs to its author and locks
at the end of the author's shift; after that nobody edits it, the author
included. The timeline never locks for anyone holding `create_incidents`.
An author with no shift records at all (office staff who never clock in) is
never locked out, because the boundary does not exist for them
(`useCanEditOriginal`).

## The timeline

Two kinds of row, interleaved by time, oldest first:

- **Addenda** (`incident_comments`): a dated, authored, append-only
  addition, as before. The glossary's **Addendum**.
- **Incident Updates** (`incident_updates`): a permanent record of a change
  to the Incident's **status** or **assignee**, with `from` and `to` as the
  names at the time, `created_at` from the device's clock, and `author_id`.
  Reads "Status Open → Closed", "Assigned to Mark Ellis". The glossary's
  **Incident Update**.

Together they are what the Shift Report shows beneath an Incident after End
of Shift. Edits to the original content are not Updates: the original is
the record, and its edit window is the author's own.

Updates are insert-only, written by `src/data/incidents.ts` in the same
transaction as the change (`setIncidentStatus`, `assignIncident`), per ADR
0008. The Activity Log entry is still written too. `incident_updates` is
Tier 1 like its parent: read with `view_incidents`, insert with
`create_incidents`, no update, no delete. It carries `required_permission`
and takes `is_recent` from its Incident, exactly as `incident_comments` do.

## Data shown

| Field | Source | Notes |
|---|---|---|
| Title, type, details | `incidents.title` / `incident_type_id` / `details` | Details is optional markdown. |
| Status | `status_id` | The marina's own list; the current status listed even if since retired. |
| Author, assignee | `author_id` / `assigned_to_id` | |
| Attachment target | the six target columns | Links to the target's page. |
| Timeline | `incident_comments` + `incident_updates`, by time | As above. |
| Linked tickets | `tickets.source_incident_id` | Each links to Ticket Detail. |

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Edit the original content | The author, until their shift ends | After that it locks for everyone. An in-progress edit at the boundary can be lost; the app warns where practical. |
| Add an addendum | `create_incidents` | Appends an `incident_comments` row. Open forever, to anyone with the permission. |
| Change status | `create_incidents` | `status` Update. |
| Assign | `create_incidents` | `assignee` Update. No self/others split for incidents. |
| Raise a ticket | None | New Ticket with `source_incident_id` set. |

A change that doesn't change anything is not written.

## States and edge cases

- **Non-author with `create_incidents`.** Can add addenda, change status and
  assign, never edit the original.
- **No `view_incidents`.** The page is unreachable; a linked Ticket shows no
  sign of the Incident.
- **Custom status.** A marina-defined status behaves like the defaults.
- **Incidents from before Updates existed.** Not backfilled; the Incident
  system was not in production use. The timeline simply starts with the
  first Addendum or Update made after.

## Mobile and desktop

Mobile: content, then the timeline, then linked tickets, stacked. Desktop:
the timeline beside the content, so both stay visible while writing.
