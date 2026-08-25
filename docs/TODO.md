# TODO

Open tasks only. Conventions and learnings live in `CLAUDE.md`; deferred
work and future phases live in `docs/ROADMAP.md`.

Verify each task against the deployment before moving on.

---

## Awaiting user action

- [ ] **Push `main`.** `beta` has been merged in cleanly (no conflicts; the
      trees are identical). The merge commit is local and unpushed —
      `git push origin main` moves the repo's default branch.
- [ ] **Turn off GitHub Pages.** Repo settings. The docs are Markdown now;
      Pages would serve them as raw files.
- [ ] **Rotate `CLERK_SECRET_KEY`.** `.env.local` records that it was exposed
      in a chat transcript on 2026-08-07. Intentionally still live; tracked
      here so it stops being invisible.

## Migration to Supabase + PowerSync

Sequenced. See [ROADMAP Phase 4](ROADMAP.md) and
[ADR 0005](adr/0005-supabase-and-powersync-replace-instantdb.md); the design
lives in `architecture.md`, `permissions.md`, `data-model.md` and
`api-structure.md`, which are written and should be read before starting.

- [x] **Docs to spec.** ADR 0005 written; ADRs 0001/0002/0004 annotated; the
      four cross-cutting docs rewritten for the new stack.
- [x] **Export tooling.** `scripts/export-instant.mjs`; output gitignored,
      regenerate rather than share.
- [ ] **Phase 3 tests first.** vitest + unit tests for the pure half of
      `src/lib`. These transfer intact and are the only automated check on
      business logic during a 66-file rewrite.
- [ ] **Provision.** Supabase project, PowerSync instance, Clerk as a
      third-party auth provider. Confirm Supabase free-tier project pausing
      (a week of inactivity) is acceptable for whatever this becomes.
- [ ] **Schema + policies.** 42 tables per `data-model.md`; RLS per its tier
      column; `effective_permissions` view; `pg_cron` retention job.
- [ ] **Sync streams.** always / occupancy / age, with the 30-day trailing
      window. Verify the resident set offline, deliberately — an untested
      scoping rule is the exact defect being migrated away from.
- [ ] **Transform + load.** Pure transform, separate load. Drop the one
      targetless ticket; `num_nonnulls(...) = 1` will reject it.
- [ ] **Rewrite.** 66 files, ~230 call sites, big-bang on one branch. Each
      page's queries move into a `src/data/` module. **No page file contains
      SQL.**
- [ ] **Offline attachment queue.** Local bytes + `upload_state`, draining
      independently of PowerSync's write queue.
- [ ] **Twilio bridge.** PostgREST with a dedicated scoped Postgres role.
- [ ] **Verify the carried-forward acceptance criterion.** The ADR 0002
      privilege-escalation vector should close structurally via `user_roles`.
      Prove it rather than assume it — this is the obligation most likely to
      be dropped now that its ADR is superseded.

## Phase 0 — Knowledge architecture ✅

- [x] Split the old `TODO.md` into `CLAUDE.md`, this file, and
      `docs/ROADMAP.md`.
- [x] Write `CONTEXT.md` — the domain glossary, corrected against the data
      model.
- [x] Delete `docs/terminology.html`, repoint its 76 references.
- [x] Merge `beta` → `main` (push pending, above).

## Phase 2 — pnpm migration ✅

- [x] `pnpm import` → `pnpm-lock.yaml`; `package-lock.json` deleted;
      `packageManager` pinned to an exact version (Corepack rejects ranges).
- [x] Declare `workbox-window`. Strict resolution surfaced it immediately:
      `vite-plugin-pwa` lists it as both a dependency *and* a peer
      dependency, the generated `virtual:pwa-register` module imports it, and
      the npm build only worked because a flat `node_modules` hoisted it into
      resolution range. It ships in the client bundle, so it belongs in
      `dependencies`.
- [x] `netlify.toml`, `README.md`, `CLAUDE.md` and the migration script
      comment updated to pnpm.
- [x] **Verified against the `beta` deploy.** Netlify resolved pnpm through
      Corepack and built; bundle hash moved `DaXTkhpc` → `CCjnSRel`. A real
      signed-in session renders the dashboard with live data, the service
      worker registers and is active (the `workbox-window` path that strict
      resolution broke), and Checklists / Tickets / Locations all navigate
      with no console errors, page errors, or ≥400 responses.

## Phase 1 — Cross-cutting docs ✅

- [x] Convert all six remaining cross-cutting docs to Markdown:
      `architecture`, `api-structure`, `data-model`, `permissions`,
      `workflows`, and `index` → `docs/README.md`. All 540 references from
      the page specs and wireframes repointed; zero broken links.
- [x] Remove the `checklist-triggers` scheduled function from
      `api-structure.md` and record why it isn't there.
- [x] Replace the claim that Instant's rules check each acting user's
      effective permission, in `api-structure.md` and with a new
      **Enforcement** section in `permissions.md`.
- [x] Document the client-vs-server criterion —
      `architecture.md` § Where work runs.
- [x] Document the migration lifecycle and pipeline order —
      `architecture.md` § Schema evolution.
- [x] Fix `README.md`: the strict permission tier is live, not "deliberately
      inactive"; checklist triggers are not a Netlify Function.
- [x] Fix the `instant.perms.ts` comment claiming per-field rules don't
      exist.
- [x] Fix the `instant.schema.ts` comment saying attachment targets are five
      links. There are six.
- [x] Write ADRs 0001–0004.

---

## Standing task

**When nothing above is open**, read `docs/ROADMAP.md` and propose the next
items to promote into this file. Don't start them unprompted — propose, then
wait.

Next up there: **Phase 3, the testing foundation** — vitest, a self-hosted
InstantDB instance, and unit tests for `src/lib/` as the harness's proving
ground.
