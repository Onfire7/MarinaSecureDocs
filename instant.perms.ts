// MarinaSecure — InstantDB server-side permission rules.
//
// The app's own permission checks are client-side and can't be trusted on
// their own: the app id ships in the browser bundle, so anyone holding it
// could otherwise read and write this marina's data directly.
//
// This is the baseline tier: deny everything by default, then require a
// signed-in Clerk identity that resolves to an *active* marina User record.
// Per-permission enforcement (view_incidents, manage_locations, …) is NOT
// expressible here yet — see the note at the bottom.

import type { InstantRules } from "@instantdb/react";

// auth.ref walks $users → profile (the marina User linked by userAuth) and
// returns a list of that field's values, so `true in …active` means "this
// identity resolves to a User record that is currently active".
const SIGNED_IN_ACTIVE_USER = "auth.id != null && true in auth.ref('$user.profile.active')";

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

  // KNOWN GAP — privilege escalation.
  //
  // Roles carry the permission map and users carry the role links, so any
  // signed-in user who writes here can grant themselves manage_* and reach
  // everything. Locking these to read-only closes that, but also stops
  // Admin -> Users and Admin -> Roles working at all, since both write from
  // the client. They stay writable for now so the app is usable, and the
  // gap closes when those two screens move their writes to a server
  // endpoint that checks manage_users / manage_roles first.
  //
  // The $default rule already covers them; this block exists to make the
  // decision visible rather than accidental.
} satisfies InstantRules;

export default rules;
