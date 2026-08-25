# Roadmap

Work that is agreed but not yet scheduled, and work deliberately deferred.
Each deferral records **why** — the reason is the part that gets forgotten.

When `docs/TODO.md` has no open tasks, read this file and propose the next
items to promote into it.

---

## The migration reshaped everything below

InstantDB retires 2027-08-31. The app moves to Supabase + PowerSync — see
[ADR 0005](adr/0005-supabase-and-powersync-replace-instantdb.md). Two
consequences for this file:

- **Feature work and schema growth are frozen** until cutover. ~80% of the
  codebase touches the database (66 of 119 files), so building features now
  builds refactoring debt against a deadline.
- **Only transferable tests get written.** `src/lib` is 2,470 lines and only
  five of its 24 files touch the database, so roughly 1,900 lines of pure
  logic are already database-agnostic and their tests survive the migration
  intact. A rules-test harness would not.

## Planned phases

Sequenced by dependency. Phases 0–2 are done.

### Phase 3 — Testing foundation *(reduced)*

- `vitest` + `@vitest/coverage-v8`
- Unit tests for the pure half of `src/lib` — `permissions.ts`,
  `checklists.ts`, `maintenanceRules.ts`, `reservations.ts`, `locations.ts`,
  `checkpoints.ts`, `assets.ts`, `contacts.ts`, `workItems.ts`, `search.ts`,
  `geo.ts`. These transfer to the new stack at 100%.
- `docs/testing/coverage-log.md`; the suite warns on any zero-coverage file
  absent from the log.

**Cut from the original plan, and why:**

- *Self-hosted InstantDB via Docker as the test target* — testing against a
  database being retired.
- *Rules-test harness using `@instantdb/admin` impersonation* — welded to
  `instant.perms.ts`, a file that will not exist. The equivalent for RLS
  policies gets built during Phase 4, against Postgres.
- *Full E2E harness* — deferred. Page-by-page conversion is verified by
  driving real sessions per `CLAUDE.md`, which is the check that matters and
  the one already in use.

### Phase 4 — Migration to Supabase + PowerSync

Depends on Phase 3: a rewrite of 66 files with no automated check on the
business logic is a bet, not a migration.

1. **Docs first.** ✅ `architecture.md`, `permissions.md`, `data-model.md`,
   `api-structure.md` rewritten to spec, ADR 0005 written, ADRs 0001/0002/0004
   annotated. This is where the relational schema, RLS policies and
   sync-stream scoping were *designed*, not documented.
2. **Export.** ✅ `scripts/export-instant.mjs`. Re-run before each reseed.
3. **Provision.** Supabase project, PowerSync instance, Clerk configured as a
   third-party auth provider.
4. **Schema + policies.** The 42 tables from `data-model.md`, RLS per the
   tier table, `effective_permissions` view, `pg_cron` retention job.
5. **Sync streams.** Always / occupancy / age scoping, with the 30-day
   trailing window on occupancy.
6. **Transform + load.** Pure transform separate from load, so a seeder can
   be extracted later without a rewrite.
7. **Rewrite.** Big-bang on one branch, no dual-write. Pages converted
   one at a time, each moving its queries into a `src/data/` module. The rule
   that keeps the seam honest: **no page file contains SQL.**
8. **Offline attachment queue.** The one piece with no vendor behind it.
9. **Twilio bridge.** Repointed to PostgREST with a dedicated scoped Postgres
   role — not the service-role key.

**Acceptance criteria carried in from elsewhere:**

- The privilege-escalation vector from
  [ADR 0002](adr/0002-client-side-permission-enforcement.md) must be closed.
  It closes structurally — role assignment becomes a row in `user_roles`,
  gated by `manage_roles` — but *verify it*, because this is the obligation
  most likely to be silently dropped when its document is superseded.
- A real signed-in session must exercise every converted page, and a
  deliberate offline test must confirm the resident set is what
  `architecture.md` claims.

### Phase 5 — Release process

- Release checklist, absorbing the `DEBUG_BUILD` pre-production item
- Dependency report: JSON plus a rendered Markdown summary. Auto-approvable
  only when patch-level **and** audit-clean **and** outside the risky set
  (`@powersync/*`, `@supabase/*`, `@clerk/*`, `vite`, `vite-plugin-pwa`,
  `typescript`)
- Spec↔code sync check: every page component has a sibling spec; every spec
  has a sibling component; no references to retired `docs/pages/*.html`;
  permission keys named in specs exist in `PERMISSIONS`. Emits a reminder
  that prose-vs-code remains a human check.

### Phase 6 — Ongoing

Page specs convert to co-located Markdown and wireframes fold into them as
each page is touched. Tests accompany every change.

> **The old Phase 5 — "Migration system" — is gone.** Its ledger,
> version-check screen, sweep script and pipeline ordering existed solely
> because an InstantDB schema push deletes removed attributes and their data
> immediately. Postgres migrations have no such property. See
> [ADR 0001](adr/0001-live-migration-not-maintenance-window.md).

---

## Deferred

### Netlify Functions surface

Shift-report send and sweep, and the Twilio bridge for calls and SMS.

**Why deferred:** it's a whole deployment surface, and nothing currently
blocked needs it.

**Smaller than it was.** The Activity Log retention purge has left this list
— under Supabase it is a `pg_cron` statement, not a deployed function.

### Time-based maintenance rules move to the client

Per the client-first criterion, "every 90 days since last completed" needs
no credential and no denied authority — only for someone to evaluate it
eventually. Same deterministic-id pattern as recurring checklists.

**Why deferred:** currently specified as a scheduled function that doesn't
exist, so nothing regresses by leaving it. Fires late if nobody opens the
app for a week — the same tradeoff already accepted for recurring
checklists.

### Sync scoping for boats, contacts and leases

`boats`, `vehicles` and `leases` are empty and `contacts` holds one row, so
the occupancy scope and its 30-day trailing window are designed against no
data — and the offline gap that drove this entire migration ("boat and
contact details weren't there") comes from that subsystem.

**Why deferred:** it cannot be validated until those tables carry real rows.
Sizing says ~1,860 contacts resident against ~8,300 created a year, but that
is arithmetic, not measurement. Revisit once the leasing and reservation
flows are in real use.

### Test coverage backfill

Existing code gets tests as it's touched, not in a sweep.

**Why deferred:** much of the code will change during the migration; testing
it first tests the wrong thing. Revisit after cutover.

### Coverage gating

Coverage stays informational.

**Why deferred:** a threshold during a rewrite is either set so low it means
nothing, or it blocks legitimate work — and it punishes deleting untested
code, which is exactly what the migration should do freely.

### Clerk invitation emails

Admin → Users provisioning works and email-matched first sign-in works.
Sending the invitation itself needs a server-side Clerk call.

**Why deferred:** needs the Netlify Functions surface above.

---

## Resolved by the migration

Recorded rather than deleted, because "why is this no longer a problem" is
worth as much as the problem was.

### Privilege escalation, vector B (role links)

Was: any active user could link their own row to an admin Role, and whether
InstantDB checked `update` on both namespaces when linking was undocumented.

**Resolved structurally.** Role assignment is a row in `user_roles`, a table
with its own policy. Granting yourself a role is an `INSERT` requiring
`manage_roles`. There is no per-entity update that reaches it, and nothing
undocumented to settle by experiment.

### Client-side stale-write reconciliation

Was: clients detect rows still carrying a migration flag and ask a Netlify
function to re-sweep them.

**Moot.** Migration flags and sweeps were artifacts of expand/sweep/contract,
which existed only because Instant's schema push destroyed data.

### Writes lost after 30+ days offline

Was: a client offline past the deletion floor syncs a write targeting a
deleted attribute; runtime attribute creation is denied, so the write is
rejected and that work is gone, silently.

**Changed shape, not gone.** Postgres has no deletion floor, so the specific
mechanism disappears. But a write targeting a dropped column still fails, and
[Architecture — Schema evolution](architecture.md) records that this remains
a property of the client rather than the database. Out of contract; recorded
because the failure is silent, and silent failure is this codebase's known
weakness.
