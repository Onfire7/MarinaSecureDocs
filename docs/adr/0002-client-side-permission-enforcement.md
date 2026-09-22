# Per-permission enforcement is client-side only

> **Superseded by [ADR 0005](0005-supabase-and-powersync-replace-instantdb.md).**
> The app is leaving InstantDB for
> Supabase + PowerSync, and per-permission enforcement stops being
> client-only: reads on the sensitive entities — incidents, contacts,
> activity log — move behind Postgres RLS. Everything below describes the
> InstantDB arrangement and is kept because the *reasoning* still applies —
> particularly the residual privilege-escalation vector, which was never
> fixed on Instant and carries forward as an acceptance criterion of the
> replacement.

The InstantDB permission rules enforce exactly one thing: that the caller is
a signed-in Clerk identity resolving to an *active* marina User, plus
`manage_roles` / `manage_users` gating on role and user writes via two
denormalized booleans. Every other permission — `view_incidents`,
`manage_locations`, `view_owner` and the rest — is checked in the UI and
nowhere else.

This is a known, accepted gap rather than an oversight. The app id ships in
the browser bundle by necessity, so any active user can read and write any
namespace directly regardless of their roles.

## Why it isn't closed

The rules can only read scalar attributes through a single-hop `auth.ref()`,
which is why the permission cache is two booleans and not an array of keys —
whether `auth.ref()` flattens a JSON array is undocumented. Enforcing the full
catalog server-side would need either per-field and per-link rules whose
semantics are not settled, or moving those writes behind a trusted server
endpoint, which would mean building and operating one per marina.

Every marina is a single organization whose users are all staff members, which
is what makes the residual risk tolerable in the meantime.

## Known residual gap

`users.update` is per-entity, not per-field, so an active user can link their
own record to an admin Role — and, until that is closed, reach everything
`manage_roles` reaches. Two vectors, in different states:

- **Setting `canManageRoles` on your own row** is closable today with a
  `newData` comparison in the update rule.
- **Linking your row to an existing admin Role** may already be closed: if
  InstantDB checks `update` on both namespaces when linking, `roles.update`
  already requires `manage_roles`. Whether it does is undocumented.
  `allow.link` / `allow.unlink` exist in the shipped `@instantdb/core` types
  but not in the published documentation, and applying a rule key the server
  might silently ignore is indistinguishable from one that works — a failure
  mode this project has already been burned by. Settle it by experiment
  against a local instance before relying on it.
