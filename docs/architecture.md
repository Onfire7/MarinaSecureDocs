# Stack & Architecture

One marina, one deployment. No shared infrastructure, no multi-tenant data model to defend — every property gets its own isolated copy of the whole stack.

> **Status.** This describes the target architecture. The app currently runs on InstantDB, which retires 2027-08-31; see [ADR 0005](adr/0005-supabase-and-powersync-replace-instantdb.md) for why this replacement was chosen and what it costs. Anything below marked *not built* is specification, not description.

## System overview

Five managed pieces make up a single marina's deployment. None is a server the team provisions or patches:

#### Static Frontend

The application itself — a static site on Netlify, on the marina's own subdomain. Also the intended host for the small set of Netlify Functions covering shift-report dispatch.

#### Supabase — Postgres

The marina's system of record: an ordinary Postgres database with row-level security. Also provides file storage for attachments, and `pg_cron` for scheduled server-side work.

#### PowerSync

The sync engine. Replicates a **scoped subset** of that Postgres into a SQLite database on each device, and drains the device's write queue back to Supabase. The app reads and writes SQLite; PowerSync makes that eventually equal Postgres.

#### Clerk

Authentication. Issues the session; Supabase is configured to trust Clerk as a third-party auth provider, so every RLS policy evaluates against a verified identity rather than a client assertion.

#### Twilio + Twilio Functions

Twilio's own serverless functions, deployed to the marina's Twilio account, bridging calls and SMS into Postgres. Also the shift-report send path, via Twilio SendGrid.

> **Per-marina isolation.** Each marina receives its own subdomain, its own Netlify deployment, its own Supabase project, its own PowerSync instance, its own Clerk application, and its own Twilio account. There is no cross-marina database, no shared auth realm, and no tenant-scoping logic anywhere in the schema — isolation is structural, not enforced by application code. It is also what makes "hand a marina their data" a `pg_dump` rather than a project.

## Frontend

| Aspect | Detail |
|---|---|
| Hosting | Netlify, one site per marina, deployed to a marina-specific subdomain. |
| Delivery | Fully static build output — no server-side rendering, no server-side session state. All dynamic behavior happens client-side against the local SQLite database. |
| Responsiveness | A single codebase serves both a native-app-like mobile experience and an efficient desktop/tablet web-app experience, with navigation patterns that diverge by breakpoint (see [Role Workflows](workflows.md)). |
| Configuration | Per-marina settings (branding, enabled features, retention policy, GPS validation defaults) are stored as data in that marina's Postgres, not as build-time configuration — so the same static build can serve every marina. |

## Database — Supabase Postgres

Postgres is the system of record. Two properties of that choice matter more than the SQL:

- **The data outlives any vendor.** If PowerSync disappears — and four products in this space vanished in about two years — the database is untouched and a different sync layer goes on top. Under a proprietary backend, the vendor *is* the data.
- **Authorization is expressible.** Row-level security says "a maintenance user cannot read security check-ins" and makes it true, rather than true-by-convention in the UI. See [Permissions — Enforcement](permissions.md).

The client never opens a Postgres connection. It talks to SQLite; writes reach Postgres through PostgREST, which is where RLS applies.

## Sync & offline behavior — PowerSync

This is the architectural decision that makes "a guard with no signal on a dark dock" a non-event rather than a special case. Dead zones at a marina are frequent and large — metal docks, metal boats, metal buildings.

- **Local-first reads and writes.** The app reads from and writes to a local SQLite database at all times. There is no separate "offline mode"; the app behaves identically whether connected or not.
- **Writes queue and drain.** Local writes go to an upload queue and reach Supabase when connectivity returns. No custom queueing or retry logic in the application.
- **Realtime updates when online.** Expected load is one or two guards at a time, so PowerSync's default reconciliation is sufficient without additional design.

### What is resident on a device

This is the part the previous stack got wrong: data was only available offline if it had been visited online first, or deliberately cached. Under PowerSync it is a declarative rule — a **sync stream** — evaluated server-side, not a caching accident.

Three scoping shapes, and every entity uses one:

| Shape | Applies to | Rule |
|---|---|---|
| **Always resident** | Locations, checkpoints, tours, location types, checklist templates, incident types, roles, marina settings, users, assets | Marina configuration. Small, changes rarely, needed everywhere. |
| **Occupancy-scoped** | Contacts, boats, vehicles, leases, reservations | Attached to an active lease or current reservation, **plus a 30-day trailing window** so an incident follow-up on last week's departed guest still works offline. |
| **Age-scoped** | Check-ins, activity log, shifts, checklist instances, incidents, tickets, calls, SMS, chat | A recent window only. Never fully resident. |

> **How this is actually expressed.** Not as a query predicate. A PowerSync
> data query is a pure function of one row, evaluated at replication time with
> no database to consult, so neither `now()` nor a cross-table subquery on a
> row value forms a constraint — both fail *silently*, matching everything.
> The windows therefore live in `refresh_sync_scopes()` (migration
> `20260826002600`), which writes a boolean onto each row on a `pg_cron`
> schedule, and the sync rules filter on that column. Changing what "recent"
> means is a change to that function, not to the rules.
>
> Two consequences are recorded in [Roadmap](ROADMAP.md) rather than solved:
> child tables need their own flag instead of a subquery off their parent, and
> permission gating cannot yet be expressed in a stream at all.

> **Why this matters numerically.** Contacts accumulate at roughly 8,300/year at a marina of this size — weekly cabin turnover, biweekly camping — while only ~1,860 are ever physically present. Syncing all contacts would put tens of thousands of rows on a phone to serve a couple of thousand useful ones, and the ratio worsens every year.

> **Unvalidated.** The `boats`, `vehicles` and `leases` tables are empty today, so the resident-set size and the 30-day window are designed against no data. Revisit both once they carry real rows.

### What offline does not cover

Telephony inherently requires connectivity. Call and SMS features are only available while online, and the UI says so honestly rather than presenting them as available offline.

## Authentication — Clerk

**Resolved: Clerk**, as a third-party auth provider to Supabase. Clerk issues the session; Supabase verifies Clerk's JWT; RLS policies read `auth.jwt() ->> 'sub'`.

- **Personal devices** — a user's phone or tablet stays signed in as that user via a normal Clerk session.
- **Shared devices** — hardware used by whoever is on shift, most often a phone handed off between guards. Clerk's **multi-session** support keeps several authenticated sessions active on one device, and switching which is active is instant.

### The offline handoff constraint

Shift handoff happens on the dock, which means it happens in a dead zone. The requirement is asymmetric and the asymmetry is the design:

- A user with a **warm session already on the device** can be switched to offline.
- A **cold sign-in** requires connectivity, and that is acceptable.
- The outgoing user must be able to **end their shift and sign out offline** regardless. The shift-end write queues like any other. The app therefore has a valid "nobody is signed in, and there are queued writes" state.

### What the JWT carries

Only the subject — Clerk's user id. **Roles and permissions are not JWT claims.**

An earlier design put effective permissions in the token so sync streams could scope on them. That was wrong twice over: PowerSync parameter queries can look up from the database directly (`SELECT id FROM users WHERE clerk_user_id = request.user_id()`), and getting permissions into a Clerk token would require writing `user.public_metadata` through Clerk's Backend API — a server-side credential, and therefore a backend this architecture does not have.

Resolving roles in the database instead means **RLS and sync-stream scoping read the same tables**, so there is one authorization model rather than two that can disagree, and a role change takes effect on reconnect without waiting for a token to refresh.

## Telephony — Twilio Functions

The Twilio↔database bridge is implemented as **Twilio Functions**, deployed into each marina's Twilio account rather than as a bespoke server. Same narrow job, no infrastructure of our own:

- Receive inbound call and SMS webhooks (the Function *is* the webhook target).
- Route calls per the marina's configured menu.
- Write call/SMS metadata, recordings and transcriptions into Postgres as they occur, so the frontend reads live data rather than polling Twilio.
- Accept outbound call/SMS initiation from the frontend and relay it to Twilio.
- Send the shift-report email via Twilio SendGrid on behalf of the shift-report Netlify Function.
- Perform contact matching (incoming number → existing Contact, or create one).

Twilio Functions are the **single gateway to Twilio** — Twilio itself, the frontend, and Netlify Functions all route through them. No other part of the system holds a Twilio credential.

> **Twilio Functions are the only writer of Twilio-sourced data.** Whenever a value passes through Twilio — a normalized phone number, a call's actual start/end timestamp, a delivery status, a SendGrid message id — the Function that received it is what writes it. Neither the frontend nor a Netlify Function writes that data itself, even when it initiated the request, because Twilio's version of the value is the one that should land in the database rather than a client-side guess made before Twilio processed it.

### The bridge's database credential

Functions write through PostgREST using a **dedicated Postgres role** with RLS policies scoped to the comms tables it legitimately writes — *not* the Supabase service-role key.

This is a deliberate downgrade from what the previous stack did. A service-role key bypasses RLS entirely, so a leaked Twilio environment variable would expose the whole marina: contacts, incidents, the activity log. A scoped role limits the blast radius to call records, which is the data the bridge already handles. The cost is one role and a handful of policies.

## Where work runs

Work belongs server-side **only if** it needs one of three things:

1. A credential that must never reach the browser (Twilio, SendGrid, the bridge's database role).
2. Authority the permission rules deliberately deny every client.
3. Execution when no client is present at all.

Everything else runs client-side. This is a deliberate bias, not a default: every server-side dependency is a piece of infrastructure to deploy, monitor and pay for per marina.

Supabase weakens the premise slightly — Edge Functions and `pg_cron` exist now, where the previous stack had nothing to lean on — but the bar stays high. See [ADR 0004](adr/0004-client-first-execution.md).

| Work | Criterion | Runs |
|---|---|---|
| Calls and SMS | 1 — Twilio credential | Twilio Function |
| Shift-report send | 1 — SendGrid credential; 3 — shift may end offline | Netlify + Twilio Function |
| Activity Log retention purge | 2 — clients cannot delete entries; 3 | **`pg_cron`** |
| Schema migrations | 1 — elevated database access | Deploy pipeline |
| Recurring checklist generation | none | **Client** |
| Meter-based maintenance rules | none | **Client** |
| Time-based maintenance rules | none | **Client** *(not yet moved)* |

The rows reading "none" are the interesting ones. Neither needs a credential nor denied authority; each only needs *someone* to evaluate it eventually. Recurring checklists already work this way: the first holder of the assigned role to open the app on a matching day creates the instance, with a deterministic id so racing clients converge on a single row rather than duplicating.

Time-based maintenance rules ("every 90 days since last completed") fit the same pattern. The cost is that a rule fires late if nobody opens the app for a week — acceptable for a maintenance ticket, and the same tradeoff already accepted for recurring checklists.

**The retention purge is the row that changed.** It was specified as a Netlify Function because the previous stack had no server-side scheduler. Supabase has `pg_cron`, so it becomes a scheduled SQL statement — one fewer deployed artifact per marina. This is the one place the migration *deletes* planned infrastructure rather than adding it.

## Attachments

Attachment files live in Supabase Storage. **PowerSync replicates rows, not blobs**, so the offline half is ours to build — the one piece of this stack with no vendor behind it.

An incident photograph is evidence, and incidents happen where the signal doesn't reach, so offline capture is a requirement rather than a nicety:

- A capture writes the file to a local store and enqueues an upload, immediately, offline or not.
- The database row referencing it is written in the same transaction and syncs normally, so the attachment's *existence* is never lost even when its bytes are still on the device.
- A row whose bytes haven't uploaded renders as pending rather than broken.
- The queue drains on reconnect, independently of PowerSync's own write queue.

> **Status.** Not built.

## Schema evolution

Ordinary Postgres migrations, applied by the deploy pipeline. Nothing resembling the previous stack's expand/sweep/contract lifecycle is required — that machinery existed solely because an InstantDB schema push deleted removed attributes and their data immediately and irreversibly. Postgres has no such property; a dropped column is a deliberate, reviewable statement.

Two constraints survive the change, because they are properties of the *client*, not the database:

- **There is no moment when every client runs the current bundle.** The app is an installable PWA with a prompt-to-update service worker. A migration that changes meaning rather than adding to it must tolerate an old bundle reading the new shape, or force an update.
- **A client offline across a destructive change loses its queued writes.** Its writes target columns that no longer exist and are rejected. Out of contract, and recorded because the failure is silent.

Sync streams are versioned with the schema: a migration that changes what a device should hold is incomplete until the corresponding stream definition ships, or devices keep syncing the old scope.

## Shift report delivery

The shift-end report is an email, so something server-side must compile and send it. Compiling and sending are split by the Twilio-source-of-truth rule above:

- A **Netlify Function** reads the shift's window from Postgres (check-ins, checklists, incidents, tickets) and compiles the report content — a database read, not a Twilio action.
- It then calls a **Twilio Function** with the compiled content and the marina's configured recipients. That Function calls **Twilio SendGrid** and, having just made the Twilio call, writes `report_sent_at` and any delivery metadata back to Postgres.

The Netlify Function is called two ways:

- **On-demand** — the frontend calls it the moment a shift ends while online.
- **Scheduled backstop** — a periodic sweep finds any shift marked ended with no report sent and dispatches it. This is what catches a shift that ended offline.

> **Offline shift end.** A guard may end their shift with no connectivity. The shift-end write queues like any other; the on-demand call never fires, but the backstop picks it up once the record syncs. The report is therefore "sent on shift end, or as soon after as connectivity allows" — never silently dropped.

> **Status.** No Netlify Function exists yet.

## Activity Log generation

The Activity Log is generated at write time, immutably, by the same code paths that make the underlying change — not reconstructed later from other tables. Any user-initiated change to persisted data should produce an entry, with two exceptions:

- Changes to the Activity Log itself.
- High-frequency, low-value changes where logging would create noise without benefit.

Each marina configures a retention period; individual entries can be flagged **Protected** to survive any purge, for legal or evidentiary reasons.

> **What the log is for.** Getting caught up on what happened recently, and
> answering "what happened to this?" quickly. It is deliberately *not* the
> audit trail: it stores one-line summaries, not records, and it is purged on a
> timer. The long-term evidentiary copy is the Records Archive — see
> [Roadmap](ROADMAP.md). Until that exists, evidentiary foreign keys are
> `ON DELETE RESTRICT` so deleting configuration cannot quietly remove the
> records attached to it.

The log is the largest table by a wide margin — an estimated 100k–250k rows per year — which is what makes retention enforcement mandatory rather than optional, and why it is age-scoped in sync and never fully resident on a device.

## Inline editing and the local-first echo

Admin edits fields in place rather than through save-buttoned forms. The naive implementation — write on every `onChange` and read `value` straight back from the query — is broken, and was: the round-trip is asynchronous, so React re-renders mid-word with the previous stored value. The caret jumps to the end, and on mobile the IME, which composes against the DOM value it last observed, reinserts what it believes is still pending and duplicates text after the caret. Deleting is worst, because the echo restores the character just removed.

Every inline field therefore goes through the shared draft components in `pages/shared/DraftInput.tsx`. The rule they enforce: **while a field has focus, the local draft is the single source of truth and incoming values are ignored.** External edits are adopted on blur, so a co-admin's change still lands, just never underneath someone's cursor. Writes are debounced while typing and flushed on blur and on unmount, so collapsing a card or navigating away cannot lose the last keystrokes. A number variant keeps the raw string locally — so a half-typed value stays editable — and reports `undefined` when cleared, which is how the schema spells "fall back to the default".

This is a general consequence of a local-first store, not a quirk of one screen or one database. It applies unchanged under PowerSync.

## Mobile layout constraints

The shell is a desktop sidenav and a mobile tab bar over the same pages, so every layout primitive has to survive a 375px viewport. Two rules in `styles/app.css` carry most of that weight, because flex and grid children default to `min-width: auto` and so refuse to shrink below their content — a long location path or a wide inline control pushes out of its card instead of compressing. `.row`, `.spread`, `.grid-2` and `.stack` children are therefore given `min-width: 0`, `.select-inline` is capped at `max-width: 100%`, and below 900px `.row` and `.spread` wrap, since a card header pairing a name field with three or four buttons genuinely cannot fit on one line. Content that is legitimately wider than a phone — the permission matrix, long scan URLs — scrolls or breaks inside its own container rather than widening the page.
