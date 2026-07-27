// MarinaSecure — InstantDB server-side permission rules.
//
// The app's own permission checks are client-side and can't be trusted on
// their own: the app id ships in the browser bundle, so anyone holding it
// could otherwise read and write this marina's data directly.
//
// CURRENT STATE: every namespace requires a signed-in Clerk identity, and
// nothing more. That closes the anonymous-access hole above, which was the
// reason this file exists, but it does NOT yet distinguish an active marina
// User from any account that can obtain a Clerk session.
//
// Two stronger tiers are written below but deliberately inactive, each with
// the reason inline: requiring an *active* marina User (blocked on the
// missing userAuth link), and gating roles/users writes on manage_roles /
// manage_users (blocked on backfilling the canManageRoles/canManageUsers
// cache). Per-permission enforcement for everything else (view_incidents,
// manage_locations, …) is only checked client-side.
//
// Hard-won rule for changing anything in this file: a rule that denies
// everyone passes every anonymous-access test. Nothing here is verified
// until a real signed-in session has been exercised against it.

import type { InstantRules } from "@instantdb/react";

// A signed-in Clerk identity, bridged to Instant by signInWithIdToken.
// This is the only check that is satisfiable today — see the note below.
const SIGNED_IN = "auth.id != null";

// WHAT THIS *SHOULD* BE, and why it isn't yet:
//
//   auth.id != null && true in auth.ref('$user.profile.active')
//
// That walks $users -> profile (the marina User linked by the `userAuth`
// link) and requires the identity to resolve to an *active* User. It is the
// rule this app wants. It is also currently unsatisfiable, because nothing
// ever creates the userAuth link: signInWithIdToken makes the $users row,
// but no code links it to the marina `users` record. With the link absent
// the ref returns an empty list, `true in []` is false, and the rule denies
// every request from every user — which is exactly what happened when it
// was deployed (the whole app locked out with "Unable to sign in").
//
// Restoring it is a three-step migration, not a one-line edit:
//   1. ship code that creates the userAuth link on sign-in,
//   2. confirm existing users have been backfilled with that link,
//   3. only then swap SIGNED_IN back to the active-user check here.
// Step 3 must be verified with a real signed-in session before it lands;
// verifying that anonymous access is denied proves nothing about whether
// legitimate access still works.
const SIGNED_IN_ACTIVE_USER = SIGNED_IN;

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
  // Baseline for every namespace. Deny-by-default was tempting, but it would
  // require naming all ~40 namespaces and would silently lock out any entity
  // added to the schema later — a failure mode that looks like the app being
  // broken. Sensitive namespaces tighten this further below.
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

  // Auth-owned namespace. The signInWithIdToken exchange creates the $users
  // row *through these rules* (server hint: input ["$users","create"]) — with
  // create: "false" every first-ever sign-in fails with "not perms-pass?",
  // which took the whole app down once origins were fixed. Own-row-only is
  // the tightest satisfiable setting: an identity can create and see itself,
  // and nothing else.
  $users: {
    allow: {
      view: "auth.id == data.id",
      create: "auth.id == data.id",
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

  // Writes here are still open to any signed-in identity. The strict rules
  // (commented out below) gate them on the canManageRoles/canManageUsers
  // booleans, but those are null on every existing User until Admin ->
  // Roles/Users rewrites them. Enforcing before that backfill deadlocks the
  // marina: nobody holds manage_roles, so nobody can grant it, so the flags
  // can never become true — and the client-side AdminGate blocks the very
  // screen that would fix it.
  //
  // To close this: populate the cache first (open Admin -> Roles and set the
  // grants, which writes the flags for every role holder), confirm a real
  // session can still write, then swap in the strict blocks and re-push.
  //
  // Break-glass if this ever deadlocks again: `instant-cli push perms`
  // always works regardless of these rules, so relaxing them is the
  // recovery path.
  roles: {
    allow: {
      view: SIGNED_IN_ACTIVE_USER,
      create: SIGNED_IN_ACTIVE_USER,
      update: SIGNED_IN_ACTIVE_USER,
      delete: SIGNED_IN_ACTIVE_USER,
    },
  },
  users: {
    allow: {
      view: SIGNED_IN_ACTIVE_USER,
      create: SIGNED_IN_ACTIVE_USER,
      update: SIGNED_IN_ACTIVE_USER,
      delete: "false",
    },
  },

  // ---- PHASE 2 rules, to swap in once the backfill above has run ----
  //
  // roles: {
  //   allow: {
  //     view: SIGNED_IN_ACTIVE_USER,
  //     create: CAN_MANAGE_ROLES,
  //     update: CAN_MANAGE_ROLES,
  //     delete: CAN_MANAGE_ROLES,
  //   },
  // },
  // users: {
  //   allow: {
  //     view: SIGNED_IN_ACTIVE_USER,
  //     create: CAN_MANAGE_ROLES_OR_USERS,
  //     update: CAN_MANAGE_ROLES_OR_USERS,
  //     delete: "false",
  //   },
  // },
} satisfies InstantRules;

export default rules;
