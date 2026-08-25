# API Structure

> **Status.** Target design. The frontend↔database half is live but currently
> runs on InstantDB, which retires 2027-08-31 — see
> [ADR 0005](adr/0005-supabase-and-powersync-replace-instantdb.md). The Twilio
> Functions and Netlify Functions below are specified but unbuilt, so calls
> and SMS read fine and nothing creates that data. See [Roadmap](ROADMAP.md).

Two integration surfaces make up the system's API: the **database**, reached
by the frontend for almost everything; and **Twilio Functions**, the single
gateway that the frontend, Twilio, and Netlify Functions all go through for
anything that has to touch Twilio.

## Two surfaces, one rule of thumb

> Frontend ↔ local SQLite ↔ PowerSync ↔ Supabase
>
> The app never opens a database connection. It reads and writes a **local SQLite database**; PowerSync replicates a scoped subset down and drains the write queue up to Supabase's PostgREST. This is the entire application except calls, SMS, and shift-report email. Which work runs where, and why, is set out in [Architecture — Where work runs](architecture.md).

> Frontend + Twilio + Netlify Functions ↔ Twilio Functions ↔ Twilio
>
> A small REST API implemented as Twilio Functions — the only thing in the system that talks to Twilio. Three callers reach it: the frontend (initiating a call/SMS), Twilio itself (inbound webhooks), and the shift-report Netlify Function. The Functions write the results into Postgres themselves; everyone else reads those results the same way they read everything else.

> **Why not have the client write call records directly?** Because initiating a call or SMS needs a Twilio credential that must never reach the browser, and Twilio's webhooks need a real HTTP endpoint to call back to. Everything without that constraint stays a direct database interaction — that is the dividing line.

> **Why Twilio Functions write the result, not the caller.** Whenever Twilio is involved, the value that lands in the database should be Twilio's version — a normalized phone number, a call's actual timestamp, a SendGrid delivery id — not what the caller guessed before Twilio processed the request. So the Function that made the Twilio call writes the outcome; the frontend and Netlify Functions that triggered it never write that data themselves. See [Architecture — Telephony](architecture.md).

## Frontend ↔ database patterns

| Pattern | Used for |
|---|---|
| **Watched local queries** | Any list or detail view that updates live — the ticket queue, an active checklist, a chat room, missed-call badges. The query runs against local SQLite and re-fires when sync changes the rows underneath it. It is *not* a network subscription; it works identically with no signal. |
| **Local-first writes** | Every user action: completing a checklist item, logging an incident, updating a meter. Written to SQLite immediately and queued; the queue drains to PostgREST when connectivity allows. |
| **Sync streams** | What a device is allowed to *hold*. Scoped by relationship and age — see [Architecture — What is resident](architecture.md). A row outside every stream the user matches simply never arrives, online or off. |
| **Row-level security** | What a device is allowed to *write*, and the backstop on what it may read. Tier 0 is any active marina user; Tier 1 gates the sensitive tables on named permissions. See [Permissions — Enforcement](permissions.md). |
| **Client-enforced permissions** | The Tier 2 remainder — `manage_checklists`, `manage_locations`, `view_reports` and the rest — checked in the UI only. [Permissions](permissions.md) states exactly what that does and does not protect. |

Because this surface is client-to-database, there is no application-defined
REST or GraphQL schema to document beyond the table structure in
[Data Model](data-model.md) and the policies in [Permissions](permissions.md).

> **The one seam that is ours.** Pages never touch the database directly.
> Queries and writes live in per-domain modules under `src/data/`, and the
> rule that keeps the seam honest is: **no page file contains SQL.**

## Attachments

Rows and bytes travel separately, because PowerSync replicates rows and not
blobs:

| Step | Where |
|---|---|
| Capture | Bytes written to a local store; an `attachments` row created with `upload_state = 'pending'`. |
| Row sync | The row syncs like any other, so the attachment's *existence* is never lost. |
| Byte upload | A local queue POSTs to Supabase Storage on reconnect, independently of PowerSync's write queue, then flips `upload_state` to `uploaded`. |

A `pending` row renders as pending rather than broken. See
[Architecture — Attachments](architecture.md).

## Twilio Functions

A minimal REST API scoped entirely to bridging Twilio, deployed to the
marina's own Twilio account rather than a hosted server. Three categories, one
per caller: **inbound webhooks** (called by Twilio), **outbound actions**
(called by the frontend, authenticated as a logged-in user), and
**server-to-server actions** (called by Netlify Functions, authenticated with
a service credential).

#### Inbound — Twilio webhooks

| Endpoint | Triggered by | Behavior |
|---|---|---|
| `POST /webhooks/voice/inbound` | An incoming call to a marina number | Looks up the dialed line in `phone_lines`, applies its routing (e.g. a security line skipping straight to a security menu), performs contact matching, creates a `calls` row, and returns TwiML directing Twilio how to proceed. |
| `POST /webhooks/voice/status` | Call state changes | Updates the `calls` row's status, duration, and missed flag. |
| `POST /webhooks/voice/recording` | A recording becomes available | Attaches the recording URL, if recording is enabled for the marina. |
| `POST /webhooks/voice/transcription` | A transcription completes | Attaches transcript text, if transcription is enabled. |
| `POST /webhooks/voice/voicemail` | A caller leaves a voicemail | Stores the voicemail URL and flags it for the missed-call badge. |
| `POST /webhooks/sms/inbound` | An incoming text | Performs contact matching, appends to (or creates) the matching `sms_threads` row, creates the `sms_messages` row, sets `last_message_at`, and marks the thread unread. |

#### Outbound — called by the frontend

| Endpoint | Requires | Behavior |
|---|---|---|
| `POST /calls/initiate` | `place_calls` | Accepts a target number (or contact) and a line; instructs Twilio to bridge the call to the requesting user's device; creates the outbound `calls` row. |
| `POST /sms/send` | `place_calls` | Accepts a target, a line, and a body (optionally from an `sms_templates` row); sends via Twilio; creates the outbound `sms_messages` row. |
| `GET /calls/active` | Authenticated user | Returns any call currently ringing or in progress for the requesting user's line(s) — drives the active-call panel without waiting on a webhook round-trip. |

> **Auth for outbound endpoints.** These verify the caller's Clerk session
> independently and check the permission themselves — they do not trust the
> frontend's own check. Note this is one of the few places `place_calls` *is*
> enforced outside the UI, because the Function is a server.

#### Server-to-server — called by Netlify Functions

| Endpoint | Requires | Behavior |
|---|---|---|
| `POST /email/shift-report/send` | Netlify service credential — there is no logged-in user in a scheduled context | Accepts compiled report content and recipients from the shift-report Netlify Function, sends via Twilio SendGrid, and — being the Function that made the Twilio call — writes `shifts.report_sent_at` and any delivery metadata itself. |

> **Auth for server-to-server endpoints.** A per-marina shared secret held as
> an encrypted environment variable on both sides, distinct from the
> Clerk-session auth used by frontend-originated calls.

#### The bridge's database credential

Twilio Functions write through PostgREST using a **dedicated Postgres role
with RLS policies scoped to the comms tables** — `calls`, `call_notes`,
`sms_threads`, `sms_messages`, and `contacts` for matching.

Not the Supabase service-role key. A service-role key bypasses RLS entirely,
so a leaked Twilio environment variable would expose the whole marina —
incidents, leases, the activity log. A scoped role limits the blast radius to
the data the bridge already handles. See
[Architecture — Telephony](architecture.md).

#### Contact matching

Both inbound webhook paths run the same step before writing:

1. Normalize the incoming number and look for an exact match against `contact_details.phone`.
2. If found, link the `calls` / `sms_threads` row to that contact.
3. If not, create a `contacts` row with no name, and a `contact_details` row carrying the number.

The nameless-contact prompt and merge-suggestion flow described in
[Role Workflows](workflows.md) happens entirely in the frontend when such a
contact is later viewed. The Function's job stops at creating the bare record.

## Netlify Functions

These run alongside the static frontend. None holds a Twilio credential or
talks to Twilio directly — the shift-report path delegates the send to
`POST /email/shift-report/send`, consistent with Twilio Functions being the
only writer of Twilio-sourced data.

| Function | Trigger | Behavior |
|---|---|---|
| `POST /reports/shift/:shiftId/send` | On-demand from the frontend, authenticated as the shift's guard or a `view_reports` holder | Compiles the report from the shift's time window (a database read) and calls the Twilio Function to send it. Does **not** call SendGrid and does **not** write `report_sent_at`. Called immediately on shift end while online; also used to re-send from Reports. |
| `scheduled: shift-report-sweep` | Netlify Scheduled Function, short interval | Finds any shift marked ended with no report sent and dispatches it the same way — the backstop for a shift that ended offline, where the on-demand call never fired. |

These read Postgres through PostgREST with their own scoped Postgres role,
following the same principle as the Twilio bridge: no component gets a
credential wider than its job.

### Two functions that no longer exist

**Activity Log retention is now `pg_cron`.** It was specified here as
`scheduled: activity-log-retention` because the previous stack had no
server-side scheduler. Supabase does, so the purge becomes a scheduled SQL
statement — one fewer deployed artifact per marina, and the only place this
migration *deletes* planned infrastructure rather than adding it. It remains
work no client may do: clients cannot delete `activity_log_entries` at all.

**Checklist generation was already absent and stays absent.** Recurring
checklists are created client-side by the first role-holder to open the app on
a matching day, using a deterministic id so racing clients converge on one row
rather than duplicating. An earlier version of this document specified a
`checklist-triggers` scheduled function; that design was replaced. See
[Architecture — Where work runs](architecture.md).
