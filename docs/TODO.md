# Agent Handoff — Bug/Feature Checklist

A punch list from user testing on the deployed app, with context gathered by the
previous agent so you can skip most discovery. Read this whole file before
starting; the **Environment & tooling** section changes how you work.

## Project context

- Vite + React 19 + TS app at repo root; page specs in `docs/` (GitHub Pages).
  Every page component's header comment names its spec (e.g.
  `docs/pages/checklist-list.html`). **Convention: behavior changes update the
  spec and the code together.**
- Data: InstantDB (`instant.schema.ts`, `instant.perms.ts` at root). Auth:
  Clerk → Instant via `signInWithIdToken` (`src/lib/auth/InstantAuthSync.tsx`).
- Deployed at **https://beta.marinasecure.com** — Netlify, auto-deploys branch
  `beta` in ~45s. Local dev server is *not* the workflow; verify against the
  deployment. Poll for a new deploy by watching the `index-*.js` hash in the
  page source change.
- Work on branch `beta`. Commit style: multi-paragraph message explaining the
  why, trailer `Co-Authored-By: <model> <noreply@anthropic.com>`.
- Verification trio before any commit: `npx tsc -b`, `npx oxlint` (ignore
  known warnings in `cards.tsx`/`CurrentUserContext.tsx`), `npm run build`
  then `rm -rf dist` (dist is gitignored; never commit it).

## Environment & tooling (critical)

- **Sign in without the UI**: `node scripts/agent-login.mjs` — mints a Clerk
  sign-in token (secret in `.env.local`), completes ticket sign-in headlessly
  against the deployment, saves Playwright storage state to
  `/tmp/pw-test/state.json`, screenshots to `/tmp/pw-test/screenshots/`.
  Reuse the state for follow-up scripts:
  `browser.newContext({ storageState: '/tmp/pw-test/state.json' })`.
  Example driver script: see the pattern in git history or write ad-hoc
  scripts under `/tmp/pw-test/`.
- **Direct DB access**: `node scripts/instant-admin.mjs query '<json>'`
  (add `--as email` / `--guest` to route through the permission rules).
  Useful e.g. to fetch a real checkpoint `guidUrl` for testing task 1.
- **Test account**: `gpp@onfire.us` — the owner's dev account, active, roles
  Security + Admin (manage_roles + manage_users). It is the only account that
  has ever completed a sign-in.
- **Permission-classifier blocks** (auto mode): Non-GET
  Clerk API curls get denied. Do **not** work around them. Sanctioned paths:
  data writes → drive the deployed app UI via Playwright as the signed-in
  user; perms changes → edit `instant.perms.ts`, then give the user the
  compiled JSON to paste into the Instant dashboard; schema changes → edit
  `instant.schema.ts`, then run
  `npx instant-cli@latest push schema --yes`.
- **Schema push deletes removed attrs immediately** (data loss — it happened
  with `roles.permissions`). Only additive changes without user sign-off.
- Perms are on a strict tier: every namespace requires an *active marina
  User* (`$default` covers new namespaces automatically, so schema additions
  just work for signed-in users). Rules read `auth.ref('$user.profile.…')` —
  scalar attributes only. Full history/rationale in `instant.perms.ts`
  comments; don't weaken rules casually.

---

## Tasks

Verify each on the deployment before moving on.

### 1. Tapping a Location should open the details page if it has no children

Currently tapping a Location drills into its child list. When a Location has
no children, that drill-in is a dead end — it should open the Location's
details page instead.

---

## Learnings from this codebase (read before debugging anything)

- **Silent failures are the house specialty.** Three separate multi-hour
  debugging spirals came from errors being swallowed: a render throw
  unmounting the whole tree (blank white page), `signInWithIdToken`
  failures logged as `console.warn` and surfaced as a misleading
  "account can't access this marina", and `.catch(console.error)` on
  transacts. Countermeasures now exist — a top-level `ErrorBoundary`
  (`src/layout/ErrorBoundary.tsx`) and the Instant auth-failure screen
  (`src/lib/auth/instantAuthStatus.ts`) — but when a screen misbehaves,
  your first stop is capturing `pageerror`, console errors, **and ≥400
  response bodies** in a Playwright run, not reading code.
- **A rule that denies everyone passes every anonymous-access test.**
  Never call a permission change verified until a real signed-in session
  has exercised it (`scripts/agent-login.mjs`). Anonymous probes only
  prove denial, which is the easy half.
- **Filtering on a link's id does not load the link.** An Instant query
  like `where: { "checkpoint.id": {...} }` returns rows with
  `checkpoint: undefined` unless the query also includes `checkpoint: {}`.
  This silently broke tour progress once; a type cast had hidden it.
- **Instant gotchas** (each cost real downtime): browser origins must be
  allowlisted in the Instant dashboard or the token exchange fails; the
  `$users` row is created *through* the permission rules on first sign-in
  (`create: "false"` breaks all new sign-ins); schema pushes **delete**
  removed attrs and their data immediately; `auth.ref()` should only read
  scalar attributes (JSON-array flattening is undocumented);
  `asUser({email})` impersonation only works for identities that have
  actually signed in.
- **Testing the site properly** (the loop that caught every real bug):
  1. Trio: `npx tsc -b` · `npx oxlint` · `npm run build` && `rm -rf dist`.
  2. Commit+push `beta`; poll https://beta.marinasecure.com until the
     `index-*.js` hash changes (~45–60s).
  3. `node scripts/agent-login.mjs` → read the printed screen text → open
     the screenshot and **look at it**.
  4. Drive the specific flow with an ad-hoc script reusing
     `/tmp/pw-test/state.json`; assert on visible text, not just absence
     of errors.
  5. Data/rules questions: `scripts/instant-admin.mjs`, with `--as` /
     `--guest` to test through the rule engine.

Nothing is "verified" until a real signed-in session has exercised it
against the deployment. Screenshots or it didn't happen.
