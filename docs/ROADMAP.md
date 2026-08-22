# Roadmap

Work that is agreed but not yet scheduled, and work deliberately deferred.
Each deferral records **why** — the reason is the part that gets forgotten.

When `docs/TODO.md` has no open tasks, read this file and propose the next
items to promote into it.

---

## Planned phases

Sequenced by dependency. Phase 0 (knowledge architecture) and Phase 1
(cross-cutting docs) are tracked in `docs/TODO.md`.

### Phase 2 — pnpm migration

Convert the lockfile with `pnpm import`, delete `package-lock.json`, add an
exact `packageManager` pin (Corepack rejects semver ranges), and update the
three places that name npm commands: `README.md`, `CLAUDE.md`, and
`netlify.toml`. Adopt strict resolution — hoisting-dependent breakage is the
point of the exercise, not a reason to avoid it.

**Lands alone, verified against a `beta` deploy.** It touches the deploy
path, and this project's history says that's where confusing failures live.

### Phase 3 — Testing foundation

Depends on Phase 2, so tooling scripts are written once.

- `vitest` + `@vitest/coverage-v8`
- Self-hosted InstantDB via Docker as the test target
- Unit tests for `src/lib/` — `permissions.ts`, `maintenanceRules.ts`,
  `checklistInstantiation.ts` and the rest of the pure logic. These are the
  harness's proving ground: cheapest possible tests, real code.
- Rules-test harness using `@instantdb/admin` impersonation
- E2E harness: tests declare prerequisites, satisfied by direct write
  unless the UI *is* the subject under test. DB resets per full run.
- `docs/testing/coverage-log.md`
- Suite warns on any zero-coverage file absent from the log

### Phase 4 — Privilege-escalation fix (vector A)

Pin `canManageRoles` / `canManageUsers` with a `newData` comparison in the
`users` update rule, so no user can grant themselves the flags the
server-side rules read. Small and independent; verify against the local
instance once Phase 3 lands.

### Phase 5 — Migration system

Depends on Phase 3 — a migration you can't rehearse is a bet, not a
migration.

- Migration ledger (per-migration state) + denormalized current-version
  field for the cheap per-load read
- Version-check screen; loading state for rows flagged unmigrated
- Sweep script, invokable by the pipeline and by hand
- Pipeline integration in the agreed order: sweep → completeness check →
  schema push (additions + eligible deletions) → build → deploy → new
  migration's sweep
- Pin `instant-cli` as a devDependency

### Phase 6 — Release process

- Release checklist, absorbing the `DEBUG_BUILD` pre-production item
- Dependency report: JSON plus a rendered Markdown summary. Auto-approvable
  only when patch-level **and** audit-clean **and** outside the risky set
  (`instant-cli`, `@instantdb/*`, `@clerk/*`, `vite`, `vite-plugin-pwa`,
  `typescript`)
- Spec↔code sync check, joining the verification trio to make it a quartet:
  every page component has a sibling spec; every spec has a sibling
  component; no references to retired `docs/pages/*.html`; permission keys
  named in specs exist in `PERMISSIONS`. Emits a reminder that prose-vs-code
  remains a human check.

### Phase 7 — Ongoing

Page specs convert to co-located Markdown and wireframes fold into them as
each page is touched. Tests accompany every change.

---

## Deferred

### Client-side stale-write reconciliation

Clients detect rows still carrying a migration flag, announce the row id to
a Netlify function, and the function re-runs a targeted sweep. All migration
logic stays server-side; the client's role is generic and carries no
per-migration code.

**Why deferred:** stale writes only appear when a client was offline across
a migration. With one active user there is nothing to reconcile. The deploy
pipeline's sweep covers everything else, and can be run by hand.

### Netlify Functions surface

Shift-report send and sweep, Activity Log retention purge, and the Twilio
bridge for calls and SMS.

**Why deferred:** it's a whole deployment surface, and nothing currently
blocked needs it. The migration sweep was deliberately routed through the
deploy pipeline instead, so migrations are not waiting on this.

### Time-based maintenance rules move to the client

Per the client-first criterion, "every 90 days since last completed" needs
no credential and no denied authority — only for someone to evaluate it
eventually. Same deterministic-id pattern as recurring checklists.

**Why deferred:** currently specified as a scheduled function that doesn't
exist, so nothing regresses by leaving it. Fires late if nobody opens the
app for a week — the same tradeoff already accepted for recurring
checklists.

### Privilege escalation, vector B (role links)

Any active user can link their own row to an admin Role. Whether Instant
checks `update` on both namespaces when linking is undocumented; if it
does, this is already closed by `roles.update: CAN_MANAGE_ROLES`.

**Why deferred:** `allow.link` / `allow.unlink` appear in the shipped
`@instantdb/core` types but not in the public docs. Applying an
undocumented rule key that the server might silently ignore looks identical
to a rule that works — and this project has already been burned by
undocumented rule behavior. Settle it with an experiment against the local
instance from Phase 3.

### Writes lost after 30+ days offline

A client offline longer than the deletion floor syncs a write targeting a
deleted attribute. Runtime attribute creation is denied, so the write is
rejected and that work is gone.

**Why not fixed:** a device offline for a month is out of contract.
Reconstructing readable content from a rejected transaction queue is real
work for a case that may never occur. Recorded because the failure is
silent, and silent failure is this codebase's known weakness.

### Test coverage backfill

Existing code gets tests as it's touched, not in a sweep. Revisit once the
page specs have finished converting and churn drops.

**Why deferred:** much of the code will change as the vision is refined;
testing it first tests the wrong thing.

### Coverage gating

Coverage stays informational. Revisit once churn drops.

**Why deferred:** a threshold during a refinement phase is either set so low
it means nothing, or it blocks legitimate work — and it punishes deleting
untested code, which is exactly what this phase should do freely.

### Clerk invitation emails

Admin → Users provisioning works and email-matched first sign-in works.
Sending the invitation itself needs a server-side Clerk call.

**Why deferred:** needs the Netlify Functions surface above.
