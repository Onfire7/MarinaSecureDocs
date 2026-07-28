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
- **Permission-classifier blocks** (auto mode): `instant-cli push
  schema/perms`, `instant-admin.mjs transact` (admin writes), and non-GET
  Clerk API curls get denied. Do **not** work around them. Sanctioned paths:
  data writes → drive the deployed app UI via Playwright as the signed-in
  user; perms changes → edit `instant.perms.ts`, then give the user the
  compiled JSON to paste into the Instant dashboard; schema changes → edit
  `instant.schema.ts`, then ask the user to run
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

Suggested order: 1–5 (small, independent) → 6–7 (one subsystem, do together)
→ 8 (CSS) → 9–10 (global, largest). Verify each on the deployment before
moving on.

### 1. Check-in URL shows the dashboard instead of the checkpoint page

Symptom: opening `/checkin/<guidUrl>` while signed in renders the dashboard.

Pointers: route wiring in `src/App.tsx` (`CheckinRoute` → `CheckinGate` →
`CheckpointCheckinPage`); page logic in
`src/pages/checklists/CheckpointCheckinPage.tsx` + `useCheckpointVisit.ts`;
sign-in redirect with `returnTo` in `src/pages/access/SignInPage.tsx`.

Not yet diagnosed. Repro first: get a real guid via
`node scripts/instant-admin.mjs query '{"checkpoints":{}}'`, then drive
`https://beta.marinasecure.com/checkin/<guid>` with the saved storage state
and watch `page.on('response')` / final URL. Candidate causes: a
`Navigate to="/"` somewhere in the not-found/no-match path; the `returnTo`
round-trip; or the guid on the physical tag not matching `guidUrl` in the DB.
Note the wildcard route `*` redirects to `/` — a route-match failure would
look exactly like this bug.

### 2. GPS validation radius visible to non-managers

`src/pages/locations/CheckpointDetailPage.tsx` renders the checkpoint's GPS
radius for everyone; `src/pages/checklists/CheckpointCheckinPage.tsx` may
too. Gate the display behind `useCurrent().can("manage_locations")`
(permission catalog: `src/lib/permissions.ts`). Keep the *validation* itself
working for everyone — only the number is manager-only.

### 3. Checklist templates can't be triggered manually

There is real gap here: `triggerType: "manual"` exists (it's even the default
for new templates — `src/pages/admin/AdminChecklistTemplatesPage.tsx:44`) but
**no UI anywhere starts one**. Add a "Start checklist" affordance on
`src/pages/checklists/ChecklistListPage.tsx` (its spec:
`docs/pages/checklist-list.html`) that lists manual-trigger templates and
instantiates one. Copy the instantiation pattern from
`startEndOfShiftChecklist` in `src/pages/home/cards.tsx` (~line 205):
`db.tx.checklists[id].update({ status: "not_started", triggeredBy: {...} })
.link({ template, assignedTo })`. Respect the template's `role` link when
deciding who sees which templates (see the existing role filter at
`ChecklistListPage.tsx:46`).

### 4. Can't assign a template to trigger by checkpoint

**Schema already has the link** (`checkpoints.checklistTemplates` many-many,
`instant.schema.ts:392`) and `useCheckpointVisit.ts:92` already spawns
checklists from `checkpoint.checklistTemplates` on check-in. What's missing
is only the **admin UI**: `AdminChecklistTemplatesPage.tsx` shows time-window
inputs when `triggerType === "checkpoint"` (~line 278) but no checkpoint
picker. Add a multi-select of checkpoints (query `{ checkpoints: {} }`,
`link`/`unlink` on save). No schema change needed.

### 5. Checkpoint trigger times: optional + across midnight

**Both already work in the logic layer** — read
`templateAppliesNow` in `src/lib/checklists.ts:123`: missing either time ⇒
always applies; `start > end` ⇒ wraps midnight (5pm–5am works). So first
verify what the user actually hit. Likely fixes are UI-level in
`AdminChecklistTemplatesPage.tsx`: no way to *clear* a time once set (add a
clear button / allow empty), and no hint text that empty = always and that
windows may wrap midnight. Update `docs/pages/admin-checklist-templates.html`
to document the semantics.

### 6. Dashboard "Complete end-of-shift checklist" goes to the list, not the checklist

Root cause found: `startEndOfShiftChecklist` in `src/pages/home/cards.tsx`
creates the checklist instance then calls `navigate("/checklists")` (~line
217). Capture the new instance's id and `navigate(\`/checklists/${id}\`)`
instead. Same bug in the clock-in path at line ~186 — fix both.

### 7. End-of-shift checklist fails to load; "Template" label confusing

Do together with 6. Two parts:

- **Fails to load**: `src/pages/checklists/ChecklistRoute.tsx` queries only
  `checklists` (instances) and renders an eternal "Loading…" when nothing
  matches — there is no not-found state, and any template-id link lands here
  forever. Repro to find where a template id leaks into a `/checklists/:id`
  link, and add a real not-found branch to `ChecklistRoute` regardless.
- **Confusing label**: `ChecklistListPage.tsx:148` — the table column header
  is "Template" and each row's link text is the template *name*
  (`c.template?.name`). Rename the column (e.g. "Checklist") so instances
  don't read as templates.

### 8. Comms: chat bubbles shouldn't sit in a visible container

`src/pages/comms/ChatRoomPage.tsx` + styles in `src/app.css` (single global
stylesheet). Remove the card/box chrome around the message bubbles so
bubbles float on the page background. Spec: `docs/pages/chat-room.html` —
update it if it shows the boxed layout.

### 9. Dark mode

`src/app.css` is the one stylesheet and currently uses literal colors.
Approach: extract the palette into CSS custom properties on `:root`, add a
dark palette under `@media (prefers-color-scheme: dark)` *and* an explicit
`[data-theme="dark"]` override; default = follow system, with a manual
toggle (persist in `localStorage`, apply in `src/main.tsx` before first
paint to avoid flash; a sensible toggle home is `src/pages/shared/MorePage.tsx`
and/or the user block in `src/layout/AppShell.tsx`). Watch contrast on badge
colors (`badge-good`/`badge-warn`/`badge-bad`) and the map/plotting UIs in
`AdminLocationsPage`. Coordinate `<meta name="theme-color">` with task 10.

### 10. PWA

Use `vite-plugin-pwa`: manifest (name MarinaSecure, icons — `favicon.svg`
exists in `public/`, generate maskable PNG sizes), `registerType:
'autoUpdate'` service worker. Notes: Netlify SPA redirect is already in
`netlify.toml`; InstantDB is offline-first so app-shell caching is the goal
(don't cache Instant/Clerk API calls); make sure `index.html` isn't served
stale (autoUpdate handles it, but verify a deploy actually propagates —
deploys are the team's only distribution channel). The NFC/QR deep link
`/checkin/:guidUrl` must keep working from inside the installed app.
Verify installability with a Lighthouse pass via Playwright/chromium.

---

## Verifying like the last agent

The loop that caught every real bug this cycle:

1. Change code → trio (`tsc`/`oxlint`/build) → commit to `beta` → push.
2. Poll the site until the bundle hash changes (~45–60s).
3. `node scripts/agent-login.mjs` → screenshot → **look at it**.
4. Drive the specific flow with an ad-hoc Playwright script reusing
   `/tmp/pw-test/state.json`; capture `pageerror`/console + failing response
   bodies (`page.on('response')` for `>=400`).
5. For rule/data questions, `instant-admin.mjs` with `--as`/`--guest`.

Hard-won rule: nothing is "verified" until a real signed-in session has
exercised it against the deployment. Screenshots or it didn't happen.
