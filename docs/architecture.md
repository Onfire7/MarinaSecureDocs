# Stack & Architecture

One marina, one deployment. No shared infrastructure, no multi-tenant data model to defend — every property gets its own isolated copy of the whole stack.

## System overview

Three pieces make up a single marina's deployment, and none of them is a server the team has to provision or patch — every piece is a managed service:

#### Static Frontend

The application itself — hosted as a static site on Netlify, on the marina's own subdomain. Also the intended host for the small set of Netlify Functions covering shift-report dispatch and scheduled work (see below).

> **Status.** The static site is deployed. No Netlify Function exists yet — see [Roadmap](ROADMAP.md).

#### InstantDB

The marina's database — local-first, syncing automatically, giving the frontend offline read/write with no custom sync logic.

#### Twilio + Twilio Functions

Twilio's own serverless functions, deployed to the marina's Twilio account, bridging calls/SMS into InstantDB. Also the shift-report send path, via Twilio SendGrid. No separately hosted telephony server.

> **Per-marina isolation.** Each marina receives its own subdomain, its own Netlify deployment, its own InstantDB instance, and its own Twilio account/subaccount with its own numbers and Twilio Functions deployment. There is no cross-marina database, no shared auth realm, and no tenant-scoping logic anywhere in the schema — isolation is structural, not enforced by application code.

## Frontend

| Aspect | Detail |
|---|---|
| Hosting | Netlify, one site per marina, deployed to a marina-specific subdomain (e.g. `harborview.marinaops.app`). |
| Delivery | Fully static build output — no server-side rendering, no server-side session state. All dynamic behavior happens client-side against InstantDB. |
| Responsiveness | A single codebase serves both a native-app-like mobile experience and an efficient desktop/tablet web-app experience, with navigation patterns that diverge by breakpoint (see [Role Workflows](workflows.md) and the [page specifications](pages/index.html) for the specific navigation model). |
| Configuration | Per-marina settings (branding, enabled features, retention policy, GPS validation defaults, etc.) are stored as data in that marina's InstantDB instance, not as separate build-time configuration — so the same static build can serve every marina. |

## Database — InstantDB

InstantDB serves as the system of record and as the offline/sync layer simultaneously. This is the architectural decision that makes "a guard with no signal on a dark dock" a non-event rather than a special case:

- **Local-first reads and writes.** The app reads from and writes to a local copy of the data at all times. There is no separate "offline mode" — the app behaves identically whether connected or not.
- **Automatic sync on reconnect.** Once connectivity returns, InstantDB reconciles local changes with the server automatically. No custom conflict-resolution, queueing, or retry logic is needed in the application.
- **Realtime updates when online.** Given the low concurrent usage this application expects (typically one to two guards active at a time, sporadic maintenance/office usage), InstantDB's built-in realtime and conflict handling is sufficient without additional design.

> **Design implication.** Because sync is automatic, nothing in the data model should assume a strict global ordering of events at write time. Where sequence matters (e.g. an Activity Log), it's derived from timestamps rather than from write order.

## Authentication — Clerk

**Resolved: Clerk**, using its native InstantDB integration. Clerk issues the session; InstantDB is configured to trust Clerk as an external auth provider (verifying Clerk's session JWT against a Clerk JWT template registered on the InstantDB app), so every InstantDB permission rule still evaluates against a real, verified identity rather than a client-asserted one.

- **Personal devices** — a user's phone or tablet stays signed in as that user via a normal Clerk session (email/password, magic link, or OTP — configurable per marina in Clerk's dashboard).
- **Shared devices** — some hardware is used by whoever is on shift, most often a phone handed off between guards at shift change, sometimes a tablet mounted at a fixed post. This is handled by Clerk's **multi-session** support: several users can each have an authenticated session active on the same device at once, and switching which one is "active" (`setActive()`) is instant — no full sign-out/sign-in cycle — which is exactly the fast daily-handoff requirement. See [User Switch](pages/user-switch.html).

Per-marina isolation extends to auth: each marina gets its own Clerk application/instance, consistent with the rest of the stack having no shared infrastructure across marinas.

## Telephony — Twilio Functions

The Twilio↔InstantDB bridge is implemented as **Twilio Functions** — Twilio's own serverless functions product — deployed directly into each marina's Twilio account rather than as a bespoke Node server we host and operate. Same narrow job, no infrastructure of our own to provision, patch, or scale:

- Receive inbound call and SMS webhooks from Twilio (the Function _is_ the webhook target — no separate host to expose).
- Route calls per the marina's configured menu (e.g. a secondary line that skips directly to a security queue).
- Write call/SMS metadata, recordings, and transcriptions (where enabled) into InstantDB as they occur, so the frontend simply reads live data rather than polling Twilio directly.
- Accept outbound call/SMS initiation requests from the frontend and relay them to Twilio.
- Send the shift-report email via Twilio SendGrid on behalf of the shift-report Netlify Function (see "Shift report delivery" below).
- Perform contact matching (incoming number → existing Contact, or create a new one) as described in [Terminology](../CONTEXT.md) and detailed further in [Data Model](data-model.md).

Twilio Functions are the **single gateway to Twilio** — every caller that needs Twilio to do something routes through them rather than talking to Twilio directly: Twilio itself (inbound webhooks), the frontend (initiating a call/SMS), and Netlify Functions (sending the shift-report email). No other part of the system holds a Twilio credential.

Functions write to InstantDB using its server-side/admin API, authenticated with a per-marina admin token stored as an encrypted Twilio Function environment variable — never exposed to the frontend. Full request/response shape is covered in [API Structure](api-structure.md). These Functions are intentionally thin: no business logic beyond bridging Twilio events into InstantDB records; everything else (call UI, notes, missed-call badges) is frontend behavior reacting to that data.

> **Why Twilio Functions over a hosted server.** The bridge logic only ever needs to react to Twilio events and make one outbound write to InstantDB — it has no state of its own and no reason to run continuously. Deploying it as a Twilio Function means one fewer service per marina to host, monitor, and keep patched; scaling and availability are Twilio's problem, not ours.

> **Twilio Functions are the only writer of Twilio-sourced data.** Whenever a value passes through Twilio — a phone number Twilio has normalized, a call's actual start/end timestamp, a delivery status, a SendGrid message ID — the Twilio Function that received it from Twilio is also what writes it to InstantDB. Neither the frontend nor a Netlify Function ever writes that data itself, even when it initiated the request, because Twilio's version of the value is the one that should land in the database, not a client-side guess made before Twilio processed it.

**data flow**

```
Inbound call/SMS
   → Twilio
     → Twilio Function (contact matching, recording/transcription capture)
       → InstantDB (marina instance)
         → Frontend (live UI update via InstantDB sync)

Outbound call/SMS
   Frontend → Twilio Function → Twilio → (recipient)
                    ↓
                InstantDB (call/SMS record written)

Shift-report email
   Netlify Function (compiles report from InstantDB, read-only)
     → Twilio Function → Twilio SendGrid → (recipients)
                    ↓
                InstantDB (Shift.report_sent_at written by the Twilio Function)
```

## Offline & sync behavior

Because InstantDB handles local-first storage and sync natively, no additional offline architecture is required in the application layer. Specifically out of scope for custom engineering:

- Manual local caching or queueing of writes made while offline.
- Custom conflict resolution for concurrent edits.
- Manual "sync now" triggers or sync-status polling — InstantDB's connection state is sufficient for any UI indicator needed (e.g. a small "offline / syncing" badge).

The one area that is _not_ covered by InstantDB's offline behavior is telephony, which inherently requires connectivity — call/SMS features are only available while online, and this should be reflected honestly in the UI (see relevant page specs) rather than presented as available offline.

## Where work runs

Work belongs server-side **only if** it needs one of three things:

1. A credential that must never reach the browser (Twilio, SendGrid, the InstantDB admin token).
2. Authority the permission rules deliberately deny every client.
3. Execution when no client is present at all.

Everything else runs client-side. This is a deliberate bias, not a default: a
static frontend against a local-first database has no server to lean on, so
every server-side dependency is a piece of infrastructure that has to be
deployed, monitored and paid for per marina.

Applying it:

| Work | Criterion | Runs |
|---|---|---|
| Calls and SMS | 1 — Twilio credential | Twilio Function |
| Shift-report send | 1 — SendGrid credential; 3 — shift may end offline | Netlify + Twilio Function |
| Activity Log retention purge | 2 — `activityLogEntries` denies `delete` to every client; 3 | Netlify Function |
| Schema push and migration sweep | 1 — admin token | Deploy pipeline |
| Recurring checklist generation | none | **Client** |
| Meter-based maintenance rules | none | **Client** |
| Time-based maintenance rules | none | **Client** _(not yet moved — see below)_ |

The two rows that read "none" are the interesting ones. Neither needs a
credential nor denied authority; each only needs *someone* to evaluate it
eventually. Recurring checklists already work this way: the first holder of
the assigned role to open the app on a matching day creates the instance,
with a deterministic id so racing clients converge on a single row rather
than duplicating. Nothing runs in the background, and nothing needs to.

Time-based maintenance rules ("every 90 days since last completed") fit the
same pattern and are specified to move to it. The cost is that a rule fires
late if nobody opens the app for a week — acceptable for a maintenance
ticket, and the same tradeoff already accepted for recurring checklists.

> **Status.** Recurring checklists and meter-based rules are built and
> client-side. Time-based maintenance rules are still specified as a
> scheduled function that does not exist, so nothing currently generates
> them — see [Roadmap](ROADMAP.md).

## Schema evolution

Schema changes are **additive only**. An InstantDB schema push deletes
removed attributes *and their data* immediately and irreversibly, so a
migration that removes anything cannot be undone by pushing the old schema
back — the attribute returns empty.

Attributes are therefore added, migrated onto, and only much later removed:

1. **Expand.** The new attributes are added, along with a per-row migration
   flag and a ledger row recording the migration and its timestamp. Nothing
   is removed.
2. **Update.** Clients take the new bundle. New writes go to the new shape
   and are backported to the old one where a backport is expressible.
3. **Sweep.** The deploy pipeline migrates every existing row server-side,
   in a short maintenance window so nobody reads a half-migrated database.
4. **Converge.** Writes that arrive afterward from clients that were offline
   during the sweep are reconciled. Rows still carrying the migration flag
   render as loading rather than showing a stale value.
5. **Contract.** At least 30 days later, and only once a query proves no row
   still holds the old shape, the old attributes are deleted.

Two consequences worth stating plainly:

- **A migration is never rolled back by reverting the schema.** To undo one,
  stop it and revert the client bundle. The added attributes are harmless
  where they sit; deleting them is the destructive act.
- **Not every migration can backport.** A widened enum, a split field, or a
  genuinely new concept has no old-shape equivalent. Those are marked
  non-backportable and force clients to update rather than letting an old
  bundle read a value it will misinterpret.

Each deploy runs: sweep any open migration → check completeness → push
schema (additions, plus any deletions now eligible) → build → deploy → sweep
the new migration. The sweep opening every build is what finishes the
previous release's tail, and it is what produces the evidence the deletion
gate needs.

> **Status.** Not built. Migrations are currently hand-run scripts under
> `scripts/`, with the schema pushed manually — see [Roadmap](ROADMAP.md).

## Shift report delivery

The shift-end report is an email, which means it can't be produced by the static frontend alone — something server-side must compile and send it. Compiling the report and sending it are split across two functions, split by the Twilio-source-of-truth rule above:

- A **Netlify Function** reads the shift's window from InstantDB (check-ins, checklists, incidents, tickets, associated by timestamp per the [Data Model](data-model.md)) and compiles the report content — an InstantDB read, not a Twilio action, so it belongs on the Netlify side.
- It then calls a **Twilio Function** with the compiled content and the marina's configured recipients. The Twilio Function is what actually calls **Twilio SendGrid** — and, having just made the Twilio call, is also what writes `Shift.report_sent_at` (and any SendGrid delivery metadata) back to InstantDB.

The Netlify Function is called two ways:

- **On-demand** — the frontend calls it directly the moment a shift ends while online, so the report goes out immediately rather than waiting for the next scheduled sweep.
- **Scheduled backstop** — the Scheduled Functions mechanism above periodically sweeps for any Shift record marked ended with no report yet sent, and dispatches it. This is what catches a shift that ended offline: the on-demand call never happened, so the sweep picks it up once the ended-shift write syncs to InstantDB.

The flow: ending a shift — by submitting the end-of-shift checklist if one is defined, or by tapping End Shift otherwise — marks the Shift record ended, which is what the on-demand call and the sweep both key off of.

> **Offline shift end.** A guard may end their shift with no connectivity. The shift-end write succeeds locally like any other InstantDB write; the on-demand call never fires, but the report is picked up by the scheduled backstop sweep once that record syncs. The report is therefore defined as "sent on shift end, or as soon after as connectivity allows and the next sweep runs" — never silently dropped.

## Activity Log generation

The Activity Log (see [Terminology](../CONTEXT.md)) is generated at write time, immutably, by the same code paths that make the underlying change — not reconstructed later from other tables. As a rule of thumb: any user-initiated change to persisted data should produce a corresponding entry, with two categories of exception:

- Changes to the Activity Log itself (it doesn't log its own writes).
- High-frequency, low-value changes where logging would create noise without benefit (exact boundaries to be defined per entity in [Data Model](data-model.md)).

Each marina configures a retention period for Activity Log entries; individual entries can be flagged **Protected** to survive any retention purge, for legal or evidentiary reasons.

## Inline editing and the local-first echo

Admin edits fields in place rather than through save-buttoned forms. The naive implementation — write to InstantDB on every `onChange` and read `value` straight back from `useQuery` — is broken, and was: the round-trip is asynchronous, so React re-renders mid-word with the previous stored value. The caret jumps to the end, and on mobile the IME, which composes against the DOM value it last observed, reinserts what it believes is still pending and duplicates text after the caret. Deleting is worst, because the echo restores the character just removed.

Every inline field therefore goes through the shared draft components in `pages/shared/DraftInput.tsx`. The rule they enforce: **while a field has focus, the local draft is the single source of truth and incoming values are ignored.** External edits are adopted on blur, so a co-admin's change still lands, just never underneath someone's cursor. Writes are debounced while typing and flushed on blur and on unmount, so collapsing a card or navigating away cannot lose the last keystrokes. A number variant keeps the raw string locally — so a half-typed value stays editable — and reports `undefined` when cleared, which is how the schema spells "fall back to the default".

This is a general consequence of a local-first store, not a quirk of one screen: any controlled input bound directly to synced state has the same defect.

## Mobile layout constraints

The shell is a desktop sidenav and a mobile tab bar over the same pages, so every layout primitive has to survive a 375px viewport. Two rules in `styles/app.css` carry most of that weight, because flex and grid children default to `min-width: auto` and so refuse to shrink below their content — a long location path or a wide inline control pushes out of its card instead of compressing. `.row`, `.spread`, `.grid-2` and `.stack` children are therefore given `min-width: 0`, `.select-inline` is capped at `max-width: 100%`, and below 900px `.row` and `.spread` wrap, since a card header pairing a name field with three or four buttons genuinely cannot fit on one line. Content that is legitimately wider than a phone — the permission matrix, long scan URLs — scrolls or breaks inside its own container rather than widening the page.
