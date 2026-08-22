# TODO

Open tasks only. Conventions and learnings live in `CLAUDE.md`; deferred
work and future phases live in `docs/ROADMAP.md`.

Verify each task against the deployment before moving on.

---

## Phase 0 — Knowledge architecture

- [x] Split the old `TODO.md` into `CLAUDE.md` (conventions, learnings,
      workflow), this file (open tasks), and `docs/ROADMAP.md` (deferred
      work with reasons).
- [x] Write `CONTEXT.md` — the domain glossary, corrected against the data
      model. Fixes the stale "global / role-restricted / personal" template
      visibility and the obsolete trigger list.
- [x] Delete `docs/terminology.html` and repoint the 76 nav links across
      `docs/` at `CONTEXT.md`.
- [ ] Merge `beta` → `main`. `main`'s three commits are pure merge bubbles
      with no unique content, so this is clean. **Needs the user to
      authorize the push.**
- [ ] Turn off GitHub Pages. The docs are for agents now; Pages has been
      serving month-stale content from `main` and nobody noticed, which is
      itself the argument. **User action in repo settings.**

## Phase 1 — Cross-cutting docs

Convert the seven top-level docs from HTML to Markdown, correcting content
in the same pass. They hold every contradiction found in the audit; the
page specs do not, so those convert incrementally instead (Phase 7).

- [ ] `architecture.html` → Markdown
- [ ] `api-structure.html` → Markdown. Remove the `checklist-triggers`
      scheduled function — checklist recurrence is client-side, created by
      the first role-holder to open the app on a matching day. Remove the
      claim that Instant's rules check each acting user's effective
      permission; only `active`, `canManageRoles` and `canManageUsers` are
      enforced server-side.
- [ ] `data-model.html` → Markdown
- [ ] `permissions.html` → Markdown
- [ ] `workflows.html` → Markdown
- [ ] `index.html` → Markdown
- [ ] Document the client-vs-server criterion: server-side only if it needs
      a credential that can't reach the browser, authority the rules deny
      every client, or execution with no client present.
- [ ] Document the migration lifecycle: expand → dual-write → sweep →
      contract, with the deprecation schedule and the pipeline ordering.
- [ ] Fix `README.md`: it says the strict permission tiers are "deliberately
      inactive." They are live — `instant.perms.ts` has been the current
      tier for some time.
- [ ] Fix the stale header comment in `instant.perms.ts` claiming per-field
      rules don't exist. They do, and Phase 4 uses them.
- [ ] Fix the schema header comment saying attachment targets are five
      links. There are six — `vehicle` was added.
- [ ] Write the four ADRs in `docs/adr/`: live migration design;
      client-side-only permission enforcement with the accepted residual;
      docs-for-agents with co-located specs; the client-first criterion.

---

## Standing task

**When nothing above is open**, read `docs/ROADMAP.md` and propose the next
items to promote into this file. Don't start them unprompted — propose, then
wait.
