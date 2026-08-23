# Supabase is the database; PowerSync is the sync engine

InstantDB is being retired. Its team joined OpenAI, new signups are closed,
and cloud apps stop serving on **2027-08-31**. The marina's system of record
becomes a **Supabase Postgres**, with **PowerSync** replicating a scoped
subset of it into SQLite on each device. Clerk stays.

The forcing event is a deadline, but the shape of the replacement was decided
by one property the app cannot give up: a guard on a dark dock, surrounded by
metal, must be able to work. Everything else was negotiable and most of it
was negotiated.

## Why not simply self-host Instant

The Instant codebase stays open source, which makes "keep what we have" the
cheapest option on paper — same schema, same permission language, same 230
call sites. It was rejected because nobody has committed to developing it,
and adopting an unmaintained sync engine as the system of record for every
marina trades a dated deadline for an undated one.

## Why a Postgres under a sync layer

The first version of this argument was wrong and is worth recording, because
the corrected version is the actual reason.

The wrong version: "Instant died, so own your Postgres next time." Instant
*was* Postgres-backed. Backing store format was never the problem.

The right version: it was **their** Postgres. There was never a connection
string. Every serious offline-first option in 2026 is a sync layer over a
database you provision yourself, which does not make the next migration free
— the client rewrite dominates either way — but it changes the catastrophic
case from a support ticket into a `pg_dump`. Four products in this space
disappeared within about two years (Realm/Atlas Device Sync, Amplify
DataStore, Triplit, Instant). Assume PowerSync is the fifth and check that
the answer still holds. It does.

## What actually discriminated

Requirements that eliminated candidates, in the order they did the work:

1. **Durable offline local store.** Dead zones at this marina are frequent
   and large. Instant's caching was already insufficient — the replacement
   must be better at this, not merely equal.
2. **Partial replication scoped by relationship and age**, with the data a
   guard needs on rounds resident whether or not it was visited online first.
3. **No backend to operate per marina.** Weakened but not abandoned: Twilio
   Functions already exist, so the bar is "no *new* tier."
4. **Server-enforced reads on sensitive entities.** Deliberately deeper than
   what Instant enforced — see *Supersedes*.
5. **Cost to start.** One marina, in development.

PowerSync + Supabase answers 2 and 4 with the *same* artifact: sync-stream
scoping and RLS policies are one model, not two. Writes go client-direct to
PostgREST, so 3 holds with no new tier. It is $0 to start, settling near
$25/month per marina. Both halves self-host free, which is a differentiator
rather than a requirement.

## Rejected

- **RxDB** — the closest thing to a tie. Removes a vendor entirely and its
  reactive queries are ergonomically nearer to `db.useQuery` than SQL is.
  Rejected because it hands back ownership of the pull query, the scoping,
  and the conflict resolution — which is precisely the logic requirement 2
  describes, and precisely what we liked about not writing. Also ~$1,188/yr
  before the storage adapters this app would need.
- **CouchDB + PouchDB** — the only genuinely unkillable option, an Apache
  project, with attachment replication native. Rejected on shape: its
  per-user database pattern does not fit one shared marina dataset with
  role-scoped views, and 101 relationships against Mango queries means
  denormalizing or joining on the client.
- **Zero** — 1.0 as of June 2026, and its query language is the easiest
  migration from InstaQL. Rejected on requirement 1: its offline story is an
  IndexedDB read cache, not a local database. It also needs `zero-cache`.
- **ElectricSQL** — read-path sync only; the write path is a backend we would
  build and run. Fails requirement 3.
- **Jazz** — the most elegant architecture here: CRDTs, cryptographic
  permissions, no server at all, binary as a first-class value. Rejected on
  fit and timing — date-filtered list views (ticket queue, activity log) are
  what CRDT object graphs handle worst, and converting 27k lines of
  relational thinking into an object graph is not this migration.
- **Firebase** — excluded by the marina.
- **Convex** — not a separate answer. Its local-first path *is* PowerSync,
  which is itself a signal: a well-funded competitor concluded the sync layer
  was not worth rebuilding.

## Auth stays Clerk, and roles ride in the JWT

Migrating identity at the same time as 66 files of data layer would make a
sign-in failure ambiguous, and this project has already lost hours to auth
failures that surfaced as misleading errors. Clerk also owns the one
requirement nothing else covers: **warm sessions must switch offline.** A
guard hands the phone over in a dead zone; the outgoing user must be able to
end their shift and sign out even though the incoming one cannot sign in
until there is signal. Supabase Auth has no multi-session equivalent.

Roles travel as JWT claims rather than being joined in RLS, because
**sync-stream scoping needs them before RLS does** — the claim decides which
rows reach the device, RLS is the backstop that makes the boundary true.

The cost, stated plainly: **a role change does not take effect for an offline
user until they reconnect.** Role changes are rare admin actions here. If
that stops being true, the fix is joining in RLS and accepting coarser sync.

## What "resident" means

Contacts accumulate at roughly 8,300/year (weekly cabin turnover, biweekly
camping) while only ~1,860 are ever present at the marina. "Reference data
always resident" therefore means **occupancy-scoped, not unconditional**:
contacts and boats attached to an active lease or current reservation, plus a
**30-day trailing window** so an incident follow-up on last week's departed
guest still works offline.

That is a *relational* scope, not an age scope — it joins through
lease/reservation date windows. PowerSync's Sync Streams support JOINs where
the legacy Sync Rules did not, which is what makes this expressible
declaratively instead of as hand-written pull logic.

The activity log is age-scoped and never fully resident. At an estimated
100k–250k rows/year it is also what drives storage, which makes retention
enforcement mandatory rather than deferred.

## Supersedes and amends

- **Supersedes [ADR 0002](0002-client-side-permission-enforcement.md).**
  Per-permission enforcement stops being client-only. Reads on the sensitive
  entities — incidents, contacts, activity log — move behind RLS. The
  residual privilege-escalation vector 0002 documents is **not** fixed on
  Instant; it carries forward as an acceptance criterion of the new model,
  and is the item most likely to be silently dropped.
- **Amends [ADR 0004](0004-client-first-execution.md).** The premise "a
  static frontend over a local-first database has no server to lean on"
  weakens: Supabase brings Edge Functions and `pg_cron`. The conclusion
  survives — the bar stays high — but the Activity Log retention purge, which
  0004 cites as the case proving the criterion has teeth, becomes a scheduled
  SQL statement rather than a Netlify Function. The migration deletes a
  planned piece of infrastructure instead of adding one.
- **Amends [ADR 0001](0001-live-migration-not-maintenance-window.md).**
  Instant's expand/sweep/contract lifecycle existed because a schema push
  deleted removed attributes and their data immediately. Postgres migrations
  do not have that property, so the elaborate machinery it justified is
  largely unnecessary.

## Accepted, with eyes open

- **The schema is redesigned, not ported.** Three documented Instant
  workarounds unwind: the six-optional-link polymorphic attachment target,
  the `…Order` sibling JSON arrays, and the two denormalized permission
  booleans. This is free now and expensive later — there are ~2,148 rows in
  the entire database.
- **Cutover is big-bang, on one branch, with no dual-write.** Dual-write
  protects live users; there are none. The reseed pipeline is the recovery
  path.
- **Attachment sync is hand-rolled.** No sync engine here replicates blobs on
  the web. A local queue over Supabase Storage is the one piece with no
  vendor behind it.
- **The scoping rules for `boats` and `contacts` are unvalidated.** Those
  tables are empty today (0 boats, 1 contact) — the requirement that drove
  this entire decision comes from a subsystem with no data in it. Revisit the
  30-day window and the resident-set size once they carry real rows.
- **Four of the six polymorphic attachment arms have no examples.** Only
  `location` and `asset` appear in real data. `boat`, `vehicle`, `contact`
  and `checkpoint` are being redesigned blind, on empty tables.
- **One real row already violates a stated invariant.** The schema claims the
  app enforces exactly one attachment target; one of seven tickets has none.
  A naive `NOT NULL` transform drops it.
