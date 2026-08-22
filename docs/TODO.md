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
- [ ] **Verify against a `beta` deploy.** Local trio passes; Netlify has to
      resolve pnpm through Corepack from the `packageManager` pin, and that
      only gets proven by a real build.

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
