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

_Nothing open right now._

---

## Before shipping to production

Not bugs and not blocking day-to-day work — deliberate development-time
settings that have to be undone before real users see the app. Check this
list at the end of development, not during it.

### Turn the React development build back off

**Beta is currently serving React's development build, unminified** — 2.1 MB
instead of 820 kB (418 kB gzipped). That was deliberate: it's what turned
"Minified React error #185" into a real message and stack, which is how the
check-in render loop got found. It should not stay on indefinitely, and must
be off before any production deploy.

Flip `DEBUG_BUILD`'s default to `false` in `vite.config.ts` (or build with
`REACT_DEV_BUILD=0`). The Workbox `maximumFileSizeToCacheInBytes` bump is
tied to the same flag and reverts with it. Keep the flag itself around —
it's cheap, and the next minified error will want it.

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
- **Never build a `db.useQuery` argument from a moving value.** A query
  whose *value* differs every render — `Date.now()`, `Math.random()`, a
  freshly-derived array — resubscribes every render through
  `useSyncExternalStore`, pushes a new snapshot, and re-renders: an
  infinite loop React kills with "Maximum update depth exceeded". This was
  the check-in page's `new Date(Date.now() - DEDUPE_WINDOW_MS)`. Pin such
  values with `useState(() => …)` or `useMemo`. Instant compares queries by
  *value*, not identity, so a stable-valued `new Date(shift.startedAt)` is
  fine — it's drift that kills, not allocation.
- **Don't trust a React error number's description second-hand.** #185 is
  "Maximum update depth exceeded" (an infinite update loop); #310 is the
  Rules-of-Hooks one. A punch-list entry asserting #185 was a hooks
  violation sent the first pass looking in the wrong place entirely. Get
  the real message — that's what the `DEBUG_BUILD` flag in `vite.config.ts`
  is for — before theorizing about the cause.
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
