# MarinaSecure — working conventions

Durable knowledge for anyone (human or agent) working in this repo. Task
lists live in `docs/TODO.md`; deferred work and its reasons live in
`docs/ROADMAP.md`; domain vocabulary lives in `CONTEXT.md`.

## What this is

A Vite + React 19 + TypeScript PWA at the repo root, backed by InstantDB
(`instant.schema.ts`, `instant.perms.ts`) with Clerk authentication. Every
marina is a fully independent deployment: its own site, its own Instant app,
its own Twilio account. Nothing is shared between marinas.

Reference docs are in `docs/`. They exist **for agents**, not for a
published site — write them accordingly.

## Development workflow

Follow this order. The gates marked **STOP** require the user's answer
before continuing.

1. Describe the goal.
2. Prototype, if the design question needs one.
3. Drive the prototype. **STOP** — get user feedback.
4. Write or update the spec.
5. Propose the tests: name each one, what it asserts, its tier, what it
   needs seeded. **STOP** — get approval before writing any of them.
6. Write the tests.
7. Write or change the code.
8. Run the tests.
9. **STOP** — user approves the change.

Approving a spec does not approve the tests derived from it. Step 5 is a
separate gate because "you tested the wrong thing" is invisible at
spec-approval time and expensive afterward.

## Conventions

- **Work on `beta`.** It deploys to https://beta.marinasecure.com in ~45s.
- **Behavior changes update the spec and the code together.** Page specs are
  co-located: `src/pages/x/ThingPage.spec.md` beside `ThingPage.tsx`.
  Migration in progress — most components still name a `docs/pages/*.html`
  spec in their header comment. Convert a page's spec when you touch it,
  folding in its wireframe, and delete the HTML pair.
- **Commit messages** are multi-paragraph and explain the *why*. Trailer:
  `Co-Authored-By: <model> <noreply@anthropic.com>`.
- **Schema changes are additive only.** Removing an attribute deletes its
  data immediately and irreversibly. Deprecation has a lifecycle — see
  `docs/` and `docs/adr/`.
- **Never roll back the schema.** To undo a migration, stop it and revert
  the client bundle. Added attributes are harmless; deleting them is not.
- **Don't weaken permission rules casually.** `instant.perms.ts` documents
  the full history and rationale inline.

## Verification

Before any commit: `pnpm exec tsc -b` · `pnpm exec oxlint` · `pnpm run build`
then `rm -rf dist` (dist is gitignored; never commit it).

This repo uses **pnpm**, pinned exactly in `package.json`'s `packageManager`
field. Its strict `node_modules` means a transitive dependency is not
importable unless it's declared — if a build fails to resolve a module you
never imported directly, declare it rather than reaching for
`--shamefully-hoist`.

Nothing is verified until a real signed-in session has exercised it.
Screenshots or it didn't happen.

## Environment & tooling

- **Sign in without the UI**: `node scripts/agent-login.mjs` mints a Clerk
  sign-in token, completes ticket sign-in headlessly against the
  deployment, saves Playwright state to `/tmp/pw-test/state.json` and
  screenshots to `/tmp/pw-test/screenshots/`. Reuse the state:
  `browser.newContext({ storageState: '/tmp/pw-test/state.json' })`.
- **Direct DB access**: `node scripts/instant-admin.mjs query '<json>'`.
  Add `--as <email>` or `--guest` to route through the permission rules —
  this is the honest way to test them.
- **Test account**: `gpp@onfire.us`, roles Security + Admin. The only
  account that has ever completed a sign-in.
- **Permission-classifier blocks**: non-GET Clerk API curls are denied.
  Don't work around them. Sanctioned paths — data writes: drive the
  deployed app via Playwright; perms changes: edit `instant.perms.ts` and
  hand the user the compiled JSON for the Instant dashboard; schema
  changes: edit `instant.schema.ts` and push via the CLI.
- **Schema push deletes removed attributes immediately.** Additive changes
  only, without explicit sign-off.

## Learnings — read before debugging anything

- **Silent failures are the house specialty.** Three multi-hour spirals came
  from swallowed errors: a render throw unmounting the tree (blank page),
  `signInWithIdToken` failures logged as `console.warn` and surfaced as a
  misleading "account can't access this marina", and `.catch(console.error)`
  on transacts. `ErrorBoundary` and `instantAuthStatus.ts` exist as
  countermeasures — but when a screen misbehaves, capture `pageerror`,
  console errors, **and ≥400 response bodies** in a Playwright run before
  reading any code.
- **A rule that denies everyone passes every anonymous-access test.** Never
  call a permission change verified until a real signed-in session has
  exercised it. Anonymous probes only prove denial, the easy half.
- **Filtering on a link's id does not load the link.** `where: {
  "checkpoint.id": {...} }` returns rows with `checkpoint: undefined`
  unless the query also includes `checkpoint: {}`. This silently broke tour
  progress once; a type cast had hidden it.
- **Never build a `db.useQuery` argument from a moving value.** A query
  whose *value* differs every render resubscribes, pushes a snapshot, and
  re-renders — an infinite loop React kills with "Maximum update depth
  exceeded". Pin such values with `useState(() => …)` or `useMemo`. Instant
  compares queries by value, so a stable `new Date(shift.startedAt)` is
  fine. It's drift that kills, not allocation.
- **Don't trust a React error number second-hand.** #185 is "Maximum update
  depth exceeded"; #310 is the Rules-of-Hooks one. Get the real message —
  that's what `DEBUG_BUILD` in `vite.config.ts` is for — before theorizing.
- **Instant gotchas**, each of which cost real downtime: browser origins
  must be allowlisted in the Instant dashboard or the token exchange fails;
  the `$users` row is created *through* the permission rules on first
  sign-in, so `create: "false"` breaks every new sign-in; schema pushes
  delete removed attrs and their data immediately; `auth.ref()` should only
  read scalar attributes (JSON-array flattening is undocumented);
  `asUser({email})` impersonation only works for identities that have
  actually signed in.
- **The testing loop that caught every real bug**: verification trio →
  commit and push `beta` → poll the deployment until the `index-*.js` hash
  changes → `agent-login.mjs`, read the printed screen text, **open the
  screenshot and look at it** → drive the specific flow with an ad-hoc
  script reusing the saved state, asserting on visible text rather than
  absence of errors → use `instant-admin.mjs` with `--as`/`--guest` for
  data and rules questions.
