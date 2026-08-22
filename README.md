# MarinaSecure

The MarinaSecure frontend: React + TypeScript + Vite, backed by InstantDB
(local-first system of record) with Clerk authentication. See
[`docs/`](docs/README.md) for the full architecture, data model,
permissions, page specs, and wireframes this implements, and
[`CONTEXT.md`](CONTEXT.md) for the domain glossary.

## Stack

- **Vite + React 19 + TypeScript** — fully static build, no SSR (deployed per
  marina to its own Netlify site).
- **InstantDB** (`@instantdb/react`) — the marina's database; local-first
  reads/writes with automatic sync, so offline needs no special handling.
  Schema lives in [`instant.schema.ts`](instant.schema.ts).
- **Clerk** (`@clerk/clerk-react`) — authentication, with multi-session
  support for shared-device user switching. InstantDB is configured to trust
  Clerk session JWTs.
- **react-router-dom** — client-side routing.

## Setup

1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill in this marina's
   InstantDB app id and Clerk publishable key.
3. Push the schema to the InstantDB app: `pnpm dlx instant-cli@latest push schema`
4. `pnpm dev`

Without env configuration the app renders a setup screen instead of crashing.

## Layout

```
instant.schema.ts        InstantDB schema — the entire data model
src/
  lib/
    config.ts            env-driven per-marina configuration
    permissions.ts       trinary permission catalog + effective computation
    db/                  InstantDB init + entity type aliases
    auth/                Clerk↔Instant session sync, current-user resolution
  layout/AppShell.tsx    desktop sidenav / mobile tab-bar shell
  routes/nav.ts          top-level sections + permission gating
  hooks/                 cross-page hooks (e.g. mobile-breakpoint detection)
  pages/
    access/              Sign In, User Switch
    home/                Dashboard + card registry
    checklists/          Checklist list, Active/Detail checklist, Tours,
                         Checkpoint check-in (+ manual dialog)
    locations/           Location list/maps, Location detail, Checkpoint detail
    tickets/             Ticket queue, Ticket detail, New ticket form
    incidents/           Incident list, Incident detail, New incident form
    reservations/        Reservation list/calendar/map, detail (+ check-in/out
                         dialog), New reservation form
    boats/               Boat & Vehicle lists/details, owners-succession editor
    contacts/            Contact list/detail, nameless-contact merge, leases
    assets/              Asset list/detail, checkout/return, meter update
    activity/            permission-scoped Activity Log feed
    reports/             Reports home (aggregates), Shift report
    admin/               all 10 configuration screens, each independently gated
    comms/               Comms home, chat rooms, SMS threads, call dialogs,
                         active-call panel, missed-comms badge
    shared/              More menu, config screen, attachment-target picker,
                         note dialog, schematic map, target activity sections
  styles/app.css         design tokens + component styles
```

## Implementation status

- ✅ Foundation: schema, auth, permissions, shell, routing
- ✅ Access group: Sign In, User Switch
- ✅ Home group: Dashboard (role-adaptive cards, edit mode)
- ✅ Checklists & Tours group: Checklist list (+ Tours tab/panel), Active
  Checklist (all 5 item types incl. nested Location-Based Checks and inline
  meter-based maintenance tickets), Checklist detail, Checkpoint check-in
  (GPS-in-background, dedupe, tab-close), Manual check-in dialog, Tour
  progress (Linear/Freeform/Randomized)
- ✅ Locations group: Location list (hierarchy/pin map/schematic map),
  Location detail (boat/vehicle occupancy, gated owner/lease sections),
  Checkpoint detail (audit view)
- ✅ Tickets group: priority-sorted queue with inline take/assign, Ticket
  detail, New ticket form (attachment-target picker)
- ✅ Incidents group: permission-gated list, Incident detail (author-locked
  original + permanent addendum thread, linked tickets), New incident form
  (inline type creation, optional raise-linked-ticket)
- ✅ Reservations group: list/calendar/schematic-map views, Reservation
  detail with check-in/check-out dialog (target status side effects,
  early/late tracking), New reservation form (reservable-targets-only
  picker, overlap guard per MarinaSettings)
- ✅ Boats & Vehicles group: tabbed lists with search, Boat detail
  (owners-in-succession editor, slip reassignment, lease), Vehicle detail
  (optional plate/owners, location reassignment)
- ✅ Owners & Contacts group: contact list/detail with merge resolution,
  nameless-contact name prompt & merge dialog, Lease detail (doubles as the
  creation form, document upload, comment thread)
- ✅ Assets group: asset list/detail with status + meter history, checkout /
  return dialog (post-return status applied on return), meter update dialog
  (absolute reading or accrued hours, correction reason, inline
  maintenance-rule tickets)
- ✅ Activity Log: entries generated at write time across every implemented
  write path, feed scoped per entry by its subject's own permission,
  Protected flag under `manage_marina_settings`
- ✅ Reports: Reports home (aggregate-only sections + shift list, gated by
  `view_reports`), Shift report compiled live by timestamp window
- ✅ Admin: home tile picker plus Users, Roles & Permissions (trinary
  matrix), Checklist Templates (builder with per-item config), Location
  Types & Locations (hierarchy, checkpoints, map upload and drag-plotting),
  Tours, Incident Types, Asset Categories & Maintenance Rules, SMS
  Templates, and Marina Settings — each independently permission-gated
- ✅ Comms: chat rooms (fully working — ordinary InstantDB data, so offline
  too) with participant computation and the join overlay; Comms home's three
  independently gated sections; SMS threads with template picker; call/SMS
  dialogs; active-call panel; floating missed-comms badge

**Every screen in the page-spec list now exists.** What remains is the
backend, without which some actions can't complete:

- ⬜ **Twilio Functions** (telephony bridge) — calls and SMS *read* fine, but
  nothing creates that data and sending/placing fails with an explicit
  error until the bridge is deployed.
- ⬜ **Netlify Functions** — shift-report send and its backstop sweep, plus
  the Activity Log retention purge (the permission rules deny `delete` on
  `activityLogEntries` to every client, so nothing else can run it).
  Checklist-trigger generation is deliberately *not* on this list: recurring
  checklists are created client-side by the first role-holder to open the app
  on a matching day. Time-based maintenance rules are specified to move to
  the same pattern — see [ADR 0004](docs/adr/0004-client-first-execution.md).
- 🟡 **InstantDB permission rules** — the strict tier is live. Every
  namespace requires a signed-in Clerk identity resolving, through the
  `userAuth` link, to an *active* marina User; `roles` writes require
  `manage_roles`, `users` creation requires `manage_roles` or `manage_users`;
  runtime attribute creation is off; `$users` is own-row only; Activity Log
  entries can't be deleted from the client. Per-permission enforcement for
  everything else (`view_incidents`, `manage_locations`, …) is client-side
  only, with one known escalation gap — both are recorded in
  [ADR 0002](docs/adr/0002-client-side-permission-enforcement.md).
- ⬜ **Clerk invitation emails** from Admin → Users need a server-side call;
  provisioning + email-matched first sign-in works today.

## Deployment

The app deploys to Netlify from this repo's root (`netlify.toml`); `docs/`
stays on GitHub Pages. Branch deploys of `beta` are the working preview.
Two per-environment settings live outside the repo:

- **Netlify env vars**: `VITE_CLERK_PUBLISHABLE_KEY` and
  `VITE_INSTANT_APP_ID` (both public-by-design; never `CLERK_SECRET_KEY`).
- **Instant allowed origins**: every origin that serves the app (the
  Netlify URL, `http://localhost:5173`, a LAN IP for phone testing) must be
  added in the Instant dashboard → Auth, or the Clerk → Instant token
  exchange fails with "Unauthorized origin" and the app shows "Can't reach
  the marina database" after sign-in.
