# API Structure

> **Status.** Neither surface below is deployed. The frontend↔InstantDB half
> is live and carries the entire application; the Twilio Functions and
> Netlify Functions described here are specified but unbuilt, so calls and
> SMS read fine and nothing creates that data. See [Roadmap](ROADMAP.md).

Two integration surfaces make up the system's API: InstantDB, talked to directly by the frontend for almost everything and by Netlify Functions for non-Twilio scheduled jobs; and Twilio Functions, the single gateway that the frontend, Twilio, and Netlify Functions all go through for anything that has to touch Twilio.

## Two surfaces, one rule of thumb

> Frontend / Netlify Functions ↔ InstantDB
>
> Direct queries, subscriptions, and writes — from the frontend for the entire application except calls, SMS, and shift-report email, and from Netlify Scheduled Functions for the work that genuinely cannot run on a client (the Activity Log retention purge, the shift-report backstop sweep). Which work that is, and why, is set out in [Architecture — Where work runs](architecture.md).

> Frontend + Twilio + Netlify Functions ↔ Twilio Functions ↔ Twilio
>
> A small REST API implemented as Twilio Functions — the only thing in the system that talks to Twilio. Three callers reach it: the frontend (initiating a call/SMS), Twilio itself (inbound webhooks), and the shift-report Netlify Function (sending the report email via Twilio SendGrid). The Functions write the results into InstantDB themselves; everyone else just reads those results the same way they read everything else.

> **Why not route calls through InstantDB writes directly?** Because initiating a call or SMS requires a server-side Twilio credential that must never reach the client, and because Twilio's own webhooks need a real HTTP endpoint to call back to. Everything that doesn't have that constraint stays a direct InstantDB interaction — that's the dividing line.

> **Why Twilio Functions write the result, not the caller.** Whenever Twilio is involved, the value that ends up in InstantDB should be Twilio's version of it — a normalized phone number, a call's actual timestamp, a SendGrid delivery ID — not whatever the caller guessed before Twilio processed the request. So the Twilio Function that made the Twilio call is also the one that writes the outcome to InstantDB; the frontend and Netlify Functions that triggered it never write that data themselves, even though they initiated the action. See [Architecture — Telephony](architecture.md).

## Frontend ↔ InstantDB patterns

| Pattern | Used for |
|---|---|
| Subscribed queries | Any list or detail view that should update live — the ticket queue, an active checklist, a chat room, missed-call badge counts. |
| Local-first writes | Every user action: completing a checklist item, logging an incident, updating an asset's meter. Written locally immediately, synced automatically per [Architecture](architecture.md). |
| Server-enforced rules | InstantDB's permission rules require a signed-in Clerk identity resolving to an **active** marina User for every namespace, and gate role and user writes on the denormalized `canManageRoles` / `canManageUsers` flags. This is the whole of what is enforced server-side. |
| Client-enforced permissions | Every other permission (`view_incidents`, `manage_locations`, …) is checked in the UI only. See [Permissions — Enforcement](permissions.md) for what that does and does not protect. |

Because this surface is direct client-to-database, there is no separate application-defined REST or GraphQL schema to document beyond InstantDB's own query/write model and the entity structure already described in [Data Model](data-model.md).

## Twilio Functions

### Twilio Functions API

A minimal REST API, scoped entirely to bridging Twilio, implemented as Twilio Functions deployed to the marina's own Twilio account rather than a hosted server (see [Architecture — Telephony](architecture.md)). Three categories of endpoint, one per caller: **inbound webhooks** (called by Twilio), **outbound actions** (called by the frontend, authenticated as a logged-in user), and **server-to-server actions** (called by Netlify Functions, authenticated with a service credential rather than a user session).

#### Inbound — Twilio webhooks

| Endpoint | Triggered by | Behavior |
|---|---|---|
| `POST /webhooks/voice/inbound` | An incoming call to a marina number | Looks up which configured line was dialed, applies its routing (e.g. the security line skipping straight to a security menu), performs contact matching, creates a `Call` record in InstantDB, and returns TwiML directing Twilio how to proceed (ring staff, play a menu, go to voicemail). |
| `POST /webhooks/voice/status` | Call state changes (ringing, answered, completed, no-answer) | Updates the corresponding `Call` record's status, duration, and missed flag. |
| `POST /webhooks/voice/recording` | A call recording becomes available | Attaches the recording URL to the `Call` record, if recording is enabled for the marina. |
| `POST /webhooks/voice/transcription` | A transcription completes | Attaches transcript text to the `Call` record, if transcription is enabled. |
| `POST /webhooks/voice/voicemail` | A caller leaves a voicemail | Stores the voicemail recording URL against the `Call` record and flags it for the missed-call badge. |
| `POST /webhooks/sms/inbound` | An incoming text to a marina number | Performs contact matching, appends to (or creates) the matching `SMSThread`, creates the `SMSMessage`, and marks the thread unread. |

#### Outbound — called by the frontend

| Endpoint | Requires | Behavior |
|---|---|---|
| `POST /calls/initiate` | `place_calls` permission | Accepts a target number (or Contact reference) and a line to call from; instructs Twilio to bridge the call to the requesting user's device; creates the outbound `Call` record. |
| `POST /sms/send` | `place_calls` permission | Accepts a target number (or Contact reference), a line, and a message body (optionally sourced from an `SMSTemplate`); sends via Twilio; creates the outbound `SMSMessage`. |
| `GET /calls/active` | Authenticated user | Returns any call currently ringing/in-progress for the requesting user's line(s) — used to drive the active-call panel/pop-up without waiting on a webhook round-trip to InstantDB in edge cases. |

> **Auth for outbound endpoints.** These authenticate the caller using the same Clerk session (see [Architecture](architecture.md)), so the Function can independently verify the request is from a logged-in user holding the required permission — it does not trust the frontend's own permission check alone.

#### Server-to-server — called by Netlify Functions

| Endpoint | Requires | Behavior |
|---|---|---|
| `POST /email/shift-report/send` | Netlify service credential (not a Clerk session — there's no logged-in user in a scheduled-function context) | Accepts the already-compiled report content and recipient list from the shift-report Netlify Function (see [Architecture — Shift report delivery](architecture.md)), sends it via Twilio SendGrid, and — being the Twilio Function that made the Twilio call — writes `Shift.report_sent_at` (and any SendGrid delivery metadata) to InstantDB itself, per the source-of-truth rule above. |

> **Auth for server-to-server endpoints.** Netlify Functions authenticate to Twilio Functions with a per-marina service credential (a shared secret stored as an encrypted environment variable on both sides), distinct from the Clerk-session auth used by frontend-originated calls.

#### Contact matching

Both inbound webhook paths run the same contact-matching step before writing a record:

1. Normalize the incoming phone number and look for an exact match against existing `Contact` records.
2. If found, link the `Call`/`SMSThread` to that contact.
3. If not found, create a new `Contact` with the phone number and no name.

The "nameless contact" prompt and merge-suggestion flow described in [Role Workflows](workflows.md) happens entirely in the frontend when such a contact is later viewed — the Twilio Function's job stops at creating the bare record.

## Netlify Functions

### Shift Report & Scheduled Jobs API

Distinct from the Twilio Functions above, these run as Netlify Functions alongside the static frontend (see [Architecture — Scheduling](architecture.md) and [Shift report delivery](architecture.md)). None of them hold a Twilio credential or talk to Twilio directly — the shift-report path delegates the actual send to the Twilio Function's `POST /email/shift-report/send` above, consistent with Twilio Functions being the only writer of Twilio-sourced data.

| Function | Trigger | Behavior |
|---|---|---|
| `POST /reports/shift/:shiftId/send` | Called on-demand by the frontend (authenticated as the shift's guard, or a user with `view_reports`) | Compiles the shift report from the shift's time window (an InstantDB read) and calls the Twilio Function's `POST /email/shift-report/send` to actually send it. Does **not** call Twilio SendGrid itself and does not write `Shift.report_sent_at` — the Twilio Function does both. Called immediately on shift end while online; also usable to re-send from the Reports section. |
| `scheduled: shift-report-sweep` | Netlify Scheduled Function, runs on a short interval (e.g. every few minutes) | Finds any Shift marked ended with no report yet sent and dispatches it the same way — compile, then hand off to the Twilio Function — the backstop for a shift that ended offline, where the on-demand call never fired. |
| `scheduled: activity-log-retention` | Netlify Scheduled Function, runs daily | Purges Activity Log entries older than the marina's configured retention window, skipping any entry flagged **Protected**. The rules deny `delete` on `activityLogEntries` to every client, so this is the only thing that can remove one. |

**Checklist generation is deliberately absent from this list.** Recurring
checklists are created client-side by the first role-holder to open the app
on a matching day, using a deterministic id so racing clients converge on one
row. An earlier version of this document specified a `checklist-triggers`
scheduled function; that design was replaced, and the client-side one is what
is built. See [Data Model — Checklist templates & instances](data-model.md)
and [Architecture — Where work runs](architecture.md).

Each of these has a narrow write path into InstantDB — evaluate a condition, then create or purge a record — using the same server-side/admin API and per-marina admin token pattern as the Twilio Functions. The shift-report path is the one exception: it reads from InstantDB but never writes the report-sent outcome itself, since that write belongs to whichever Function actually talked to Twilio.
