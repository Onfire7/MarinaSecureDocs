# MarinaSecure

The MarinaSecure frontend: React + TypeScript + Vite, backed by InstantDB
(local-first system of record) with Clerk authentication. See
[`docs/`](docs/index.html) for the full architecture, data model,
permissions, page specs, and wireframes this implements.

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

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in this marina's
   InstantDB app id and Clerk publishable key.
3. Push the schema to the InstantDB app: `npx instant-cli@latest push schema`
4. `npm run dev`

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
    shared/              placeholders, More menu, config screen,
                         attachment-target picker, note dialog, schematic map,
                         target activity sections
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
- ⬜ Everything else renders a placeholder — see the docs' page-spec list for
  the remaining groups (Comms, Assets, Activity Log, Reports, Admin), plus
  InstantDB permission rules, Netlify Functions (shift report + scheduled
  jobs — including scheduled-trigger Checklist generation and time-based
  maintenance rules), and Twilio Functions (telephony bridge).
