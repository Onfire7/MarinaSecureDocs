import { init, id, lookup } from "@instantdb/react";
import type { InstaQLEntity } from "@instantdb/react";
import schema, { type AppSchema } from "../../../instant.schema";

// Per-marina InstantDB instance (see docs: Stack & Architecture — one instance
// per deployment, configured at build time via environment).
export const INSTANT_APP_ID = import.meta.env.VITE_INSTANT_APP_ID as
  | string
  | undefined;

// A placeholder id keeps `db` non-null for module graph simplicity; the config
// gate in App.tsx prevents any page from rendering (and thus querying) until a
// real app id is configured.
export const db = init({
  appId: INSTANT_APP_ID ?? "00000000-0000-0000-0000-000000000000",
  schema,
});

export { id, lookup };
export type { AppSchema };

export type User = InstaQLEntity<AppSchema, "users">;
export type Role = InstaQLEntity<AppSchema, "roles">;
export type UserWithRoles = InstaQLEntity<AppSchema, "users", { roles: object }>;
export type Shift = InstaQLEntity<AppSchema, "shifts">;
export type Ticket = InstaQLEntity<AppSchema, "tickets">;
export type Incident = InstaQLEntity<AppSchema, "incidents">;
export type Reservation = InstaQLEntity<AppSchema, "reservations">;
