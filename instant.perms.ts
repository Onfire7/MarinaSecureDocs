// MarinaSecure — InstantDB server-side permission rules.
//
// The app's own permission checks are client-side and can't be trusted on
// their own: the app id ships in the browser bundle, so anyone holding it
// could otherwise read and write this marina's data directly.
//
// CURRENT TIER: every namespace requires a signed-in Clerk identity that
// resolves — through the userAuth link created on sign-in (useCurrentUser)
// — to an *active* marina User. Role grants can only be written by
// manage_roles holders, checked against the canManageRoles/canManageUsers
// booleans denormalized onto users (kept current by the Admin Roles/Users
// cache cascade). Per-permission enforcement for everything else
// (view_incidents, manage_locations, …) remains client-side only.
//
// Hard-won rules for changing anything in this file:
// - A rule that denies everyone passes every anonymous-access test. Nothing
//   here is verified until a real signed-in session has been exercised
//   against it (scripts/agent-login.mjs) — and enforcement must never land
//   before the data it reads has been backfilled, or the marina deadlocks.
// - Break-glass: `instant-cli push perms` (or the dashboard Permissions
//   editor) works regardless of these rules; relaxing them is always the
//   recovery path.

import type { InstantRules } from "@instantdb/react";

// auth.ref walks $users → profile (the marina User linked by userAuth, which
// useCurrentUser creates lazily on first sign-in) and returns a list of that
// field's values, so `true in …` means "this identity resolves to a User
// record where the flag is true". Only plain scalar attributes are ever read
// this way — whether auth.ref() flattens a JSON-array attribute is
// undocumented, which is why the permission cache is two booleans and not an
// array of permission keys.
const SIGNED_IN_ACTIVE_USER =
  "auth.id != null && true in auth.ref('$user.profile.active')";
const CAN_MANAGE_ROLES =
  "auth.id != null && true in auth.ref('$user.profile.canManageRoles')";
const CAN_MANAGE_USERS =
  "auth.id != null && true in auth.ref('$user.profile.canManageUsers')";
// manage_roles can already edit any role's grants — including ones it
// currently holds — which reaches everything manage_users can. They're
// treated as equally trusted where users-namespace writes are gated.
const CAN_MANAGE_ROLES_OR_USERS = `(${CAN_MANAGE_ROLES}) || (${CAN_MANAGE_USERS})`;

// Bootstrap clause for first sign-ins: before the userAuth link exists, the
// active-user check above is unsatisfiable for that identity, yet the claim
// flow must find the email-matched User row, write clerkUserId, and create
// the link. Own-email scoping keeps this from exposing anyone else's row.
const OWN_ROW_BY_EMAIL = "auth.email == data.email";

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
  // and nothing else. (Linking users.authUser → $users does not require
  // $users update — verified empirically with update: "false" in place.)
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

  // Role grants are the root of every other permission, so writing them is
  // reserved for manage_roles holders.
  roles: {
    allow: {
      view: SIGNED_IN_ACTIVE_USER,
      create: CAN_MANAGE_ROLES,
      update: CAN_MANAGE_ROLES,
      delete: CAN_MANAGE_ROLES,
    },
  },

  // users carries role links, the permission cache, and self-serve fields
  // (dashboardLayout, clerkUserId claim, authUser link), which pulls its
  // rules in opposite directions:
  //
  // - view/update carry the OWN_ROW_BY_EMAIL bootstrap so a first sign-in
  //   can claim its row before the userAuth link exists.
  // - create is manage-only: provisioning happens in Admin → Users.
  // - KNOWN RESIDUAL GAP: update is per-entity, not per-field, so any
  //   *active* user can still update users rows — including linking roles or
  //   setting the canManage flags on their own row. Closing that needs
  //   either per-field/link rules from Instant or moving these writes to a
  //   trusted server endpoint. What this tier does close: outsider Clerk
  //   accounts (no active marina User) now have no access at all, and role
  //   *grants* can't be edited without manage_roles.
  users: {
    allow: {
      view: `(${SIGNED_IN_ACTIVE_USER}) || (${OWN_ROW_BY_EMAIL})`,
      create: CAN_MANAGE_ROLES_OR_USERS,
      update: `(${SIGNED_IN_ACTIVE_USER}) || (${OWN_ROW_BY_EMAIL})`,
      delete: "false",
    },
  },
} satisfies InstantRules;

export default rules;
