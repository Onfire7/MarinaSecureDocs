# TODO

Open tasks only. Conventions and learnings live in `CLAUDE.md`; deferred
work and future phases live in `docs/ROADMAP.md`.

Verify each task against the deployment before moving on.

---

## Awaiting user action

- [ ] **Decide when `beta` moves to the rewrite.** `rewrite/powersync` is
      pushed and building at
      https://rewrite-powersync--marinasecure.netlify.app — Netlify's
      `allowed_branches` now holds `beta` and `rewrite/powersync`, so both
      deploy. beta.marinasecure.com is still the InstantDB build and still
      works; it stays that way until you fast-forward `beta`, which is a
      clean fast-forward (no merge commit).

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
- [x] **Phase 3 tests first.** vitest + 103 unit tests across 13 files
      covering the pure half of `src/lib`. `permissions.ts`, `contacts.ts`,
      `detId.ts`, `geo.ts`, `search.ts` and `shiftReport.ts` at 100%.
      `docs/testing/coverage-log.md` records every untested file with its
      reason; `pnpm run coverage:check` fails on one that isn't listed.
- [x] **Provision.** Supabase project, PowerSync instance, Clerk as a
      third-party auth provider — see `scripts/provision-supabase.sh`.
      Verified: a real minted Clerk JWT is accepted by Supabase with
      `role: authenticated`, which is the third-party-auth trap ADR 0005
      flagged. `powersync_role` and the publication are NOT verified from
      here — Supabase direct connections are IPv6-only without the IPv4
      add-on, so `psql` can't reach them from this machine.
- [x] **Schema + policies.** 42 tables per `data-model.md`; RLS per its tier
      column; `effective_permissions` view; `pg_cron` retention job.
- [x] **Sync streams.** always / occupancy / age, with the 30-day trailing
      window, and permission gates that compile to bucket parameters.
- [x] **Transform + load.** Pure transform, separate load. Local only — the
      remote database has the schema and none of the data.
- [x] **Rewrite.** Done on `rewrite/powersync`. 19 modules under `src/data/`,
      every page converted, no page file contains SQL, and nothing in `src/`
      imports InstantDB. tsc 0 · oxlint 0 · 106 unit tests · 55 pgTAP · build
      clean.
- [x] **Verify the carried-forward acceptance criterion.** Closed
      structurally: `computeManagementFlags()` is deleted, `user_permissions`
      is maintained by a database trigger, and there is no permission column
      on the user row for a client to write. See `src/lib/permissions.ts`.

### Blocking, and only you can do it

- [x] **Add `"aud": "authenticated"` to the Clerk session token.** Done —
      PowerSync accepts the token and streams. Clerk dashboard → Configure →
      Sessions → Customize session token; PowerSync requires the claim
      unconditionally and rejected every token without one (`PSYNC_S2105`).
      Stage 3 of `scripts/provision-supabase.sh`, stage 1 of
      `scripts/finish-powersync-cutover.sh`.

### Then

- [x] **Verify a real signed-in session against synced data.** Done against
      the LOCAL stack, 2026-08-27. Sync down with every stream scoped
      correctly — contacts 1,929 of 8,402, reservations 641 of 4,481,
      check_ins 183 of 9,857, activity 711 of 6,190, `user_permissions` 22
      (this user alone) — and sync up proven end to end: taking a ticket wrote
      `assigned_to_id` and its `ticket.assigned` activity row into Postgres in
      one transaction. Twelve pages toured with no page errors, no console
      errors and no ≥400 responses. It also found the LEFT-JOIN scan that
      CLAUDE.md now documents; the list pages were 30s before the fix.

      Still to do here: repeat it against `beta` once the remote database has
      data, which is the next item.
- [x] **Point PowerSync Cloud at Clerk's JWKS.** Done. The instance was
      rejecting every token with `PSYNC_S2204`; the JWKS URI is Clerk's, not
      Supabase's. Stage 4 of the cutover wizard now asks for it — it only
      asked for the audience before, which is why this was missed.

- [x] **Deploy the sync rules to PowerSync Cloud.** Done. Auth alone got as
      far as `PSYNC_S2302 — No sync config available`. The local service
      bind-mounts `powersync/config/sync-config.yaml` from the repo, so this
      never looks like a deploy step. Now stage 5 of the cutover wizard.

- [x] **Seed the remote database.** Done 2026-09-10 via the transaction
      pooler: 2,240 config rows + 41,698 synthetic. Verified live — dashboard
      in 19s, contacts / boats (739) / vehicles (98) / locations /
      reservations all rendering, zero console errors, zero >=400 responses.

      Two things had to be fixed to get there. The seed transform emitted
      Instant's `checkIns` against a CHECK constraint that wants table names,
      and `refresh_sync_scopes_all()` had never run, so every occupancy
      stream was empty while every ungated stream was full — which reads
      exactly like a broken permission gate and is not.

- [x] **Reload the remote from a current InstantDB export.** Done 2026-09-10.
      Truncated and reloaded from a fresh export: 3,585 rows, real data only,
      no synthetic occupancy. A backup of the previous contents (the synthetic
      year) is at `/tmp/marina-backup/remote-*.sql` — not in the repo, and not
      permanent. Verified live: dashboard in 11s, a real shift in progress, 19
      open incidents, 5 open tickets, 214 check-ins with 54 inside the rounds
      window, zero errors.

      The export is 18 days newer than the one the synthetic seed was built
      from, and the marina has been in real use: +888 checklist instance items,
      +228 sections, +118 activity entries, +63 check-ins, +12 shifts, +6
      incidents.

- [ ] **Decide what happens to tickets with no attachment target.** The reload
      dropped exactly one real row — "Door left unlocked: Water Storage Door" —
      because the schema requires a ticket to point at exactly one subject and
      that one points at none. The loader reported it rather than failing,
      which is right for a seed and wrong for a cutover: at real cutover this
      is silent data loss unless it is either fixed in InstantDB first or the
      constraint is relaxed. One row today, but it is a class, not an incident.

- [ ] **Rotate the Supabase `postgres` password.** It was handed over in this
      session to seed through the pooler, and the pooler presents Supabase's
      own private CA, so that seed ran over TLS that was encrypted but not
      verified. Neither is a breach; both are reasons not to leave the
      credential as it is.

- [ ] **Fix `VITE_SUPABASE_URL` on the `beta` context too.** It was set to
      `https://<ref>.supabase.co/rest/v1/`, so supabase-js built
      `/rest/v1/rest/v1/rpc/...` and every RPC 404'd. Corrected for all
      contexts on 2026-09-10; re-check it when `beta` moves to the rewrite.

- [ ] **Offline attachment queue.** Local bytes + `upload_state`, draining
      independently of PowerSync's write queue. `captureAttachment()` writes
      the row first and fails loudly if the bytes cannot go, so nothing is
      silently lost meanwhile.
- [ ] **Twilio bridge.** PostgREST with a dedicated scoped Postgres role.
- [ ] **Gate `marina_config` on being a marina user.** Found during the
      rewrite: the always-resident stream has no parameter query, so any valid
      Clerk token for this instance syncs every marina-configuration table —
      including `users`, with names, emails and phone numbers. Every other
      stream is gated. Needs a sync-rules experiment to fix, which the local
      PowerSync makes cheap.

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
