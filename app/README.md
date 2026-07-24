# MarinaSecure — Application

The MarinaSecure frontend: React + TypeScript + Vite, backed by InstantDB
(local-first system of record) with Clerk authentication. See the docs on the
`main` branch (repo root, `index.html`) for the full architecture, data model,
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
  pages/
    access/              Sign In, User Switch
    home/                Dashboard + card registry
    shared/              placeholders, More menu, config screen
  styles/app.css         design tokens + component styles
```

## Implementation status

- ✅ Foundation: schema, auth, permissions, shell, routing
- ✅ Access group: Sign In, User Switch
- ✅ Home group: Dashboard (role-adaptive cards, edit mode)
- ⬜ Everything else renders a placeholder — see the docs' page-spec list for
  the remaining groups (Checklists & Tours, Locations, Comms, Tickets,
  Incidents, Reservations, Boats, Owners & Contacts, Assets, Activity Log,
  Reports, Admin), plus InstantDB permission rules, Netlify Functions
  (shift report + scheduled jobs), and Twilio Functions (telephony bridge).
