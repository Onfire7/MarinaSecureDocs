// MarinaSecure — InstantDB server-side permission rules.
//
// The app's own permission checks are client-side and can't be trusted on
// their own: the app id ships in the browser bundle, so anyone holding it
// could otherwise read and write this marina's data directly.
//
// Every namespace requires a signed-in Clerk identity that resolves to an
// *active* marina User record. On top of that baseline, `roles` and `users`
// are gated by the canManageRoles/canManageUsers cache below, which closes
// the privilege-escalation hole where any signed-in user could otherwise
// grant themselves manage_* by writing their own role links directly.
// Per-permission enforcement for everything else (view_incidents,
// manage_locations, …) is not expressible here yet — those permissions are
// only checked client-side for now.

import type { InstantRules } from "@instantdb/react";

// auth.ref walks $users → profile (the marina User linked by userAuth) and
// returns a list of that field's values, so `true in …active` means "this
// identity resolves to a User record that is currently active".
const SIGNED_IN_ACTIVE_USER = "auth.id != null && true in auth.ref('$user.profile.active')";

// Same one-hop auth.ref pattern, reading the denormalized canManageRoles /
// canManageUsers booleans (see instant.schema.ts, User) instead of a
// permission-array attribute — whether auth.ref() flattens a JSON array
// value or returns a list-of-lists is undocumented, so these rules only
// ever read plain scalar attributes off the single linked profile.
const CAN_MANAGE_ROLES = "auth.id != null && true in auth.ref('$user.profile.canManageRoles')";
const CAN_MANAGE_USERS = "auth.id != null && true in auth.ref('$user.profile.canManageUsers')";
// manage_roles can already edit any role's grants — including ones it
// currently holds — which reaches everything manage_users can, without ever
// writing to `users`. Since Instant's update rule is per-entity (not
// per-field), gating `users` writes any tighter would still leave that path
// open while breaking the Admin Roles cache-cascade for a manage_roles-only
// admin, so both permissions are treated as equally trusted here.
const CAN_MANAGE_ROLES_OR_USERS = `(${CAN_MANAGE_ROLES}) || (${CAN_MANAGE_USERS})`;

const rules = {
  // Baseline for every namespace: signed in, and resolving to an active
  // marina User. Deny-by-default was tempting, but it would require naming
  // all ~40 namespaces and would silently lock out any entity added to the
  // schema later — a failure mode that looks like the app being broken.
  // Sensitive namespaces tighten this further below.
  $default: {
    allow: {
      $default: SIGNED_IN_ACTIVE_USER,
    },
  },

  // The schema is authored in instant.schema.ts and pushed by the CLI —
  // clients must never invent attributes at runtime.
  attrs: {
    allow: {
      $default: "false",
    },
  },

  // Auth-owned namespaces: readable so the app can resolve its own identity,
  // never writable from the client.
  $users: {
    allow: {
      view: "auth.id != null",
      create: "false",
      update: "false",
      delete: "false",
    },
  },

  $files: {
    allow: {
      view: SIGNED_IN_ACTIVE_USER,
      create: SIGNED_IN_ACTIVE_USER,
      update: "false",
      delete: SIGNED_IN_ACTIVE_USER,
    },
  },

  // The Activity Log is an immutable, write-time audit record: entries are
  // created alongside the change they describe and never edited afterward.
  // The one exception is the Protected flag, which exempts an entry from the
  // retention purge — so update is allowed but delete never is, leaving the
  // scheduled purge (server-side) as the only thing that removes entries.
  activityLogEntries: {
    allow: {
      view: SIGNED_IN_ACTIVE_USER,
      create: SIGNED_IN_ACTIVE_USER,
      update: SIGNED_IN_ACTIVE_USER,
      delete: "false",
    },
  },

  // Roles carry the allow/deny grants; users carry the role links and the
  // canManageRoles/canManageUsers cache derived from them. Gated so that a
  // signed-in user with neither management permission can never grant
  // themselves one — view stays open to every active user since the app
  // needs each user's own roles to compute permissions client-side.
  roles: {
    allow: {
      view: SIGNED_IN_ACTIVE_USER,
      create: CAN_MANAGE_ROLES,
      update: CAN_MANAGE_ROLES,
      delete: CAN_MANAGE_ROLES,
    },
  },

  // Same reasoning as roles — view stays open (the app needs to resolve
  // its own identity and list users on the Users screen), writes require
  // CAN_MANAGE_ROLES_OR_USERS (see above for why manage_roles counts too).
  // No client path deletes a user (Admin Users deactivates instead), so
  // delete is never allowed.
  users: {
    allow: {
      view: SIGNED_IN_ACTIVE_USER,
      create: CAN_MANAGE_ROLES_OR_USERS,
      update: CAN_MANAGE_ROLES_OR_USERS,
      delete: "false",
    },
  },
} satisfies InstantRules;

export default rules;
