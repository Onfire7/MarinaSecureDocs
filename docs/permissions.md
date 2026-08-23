# Permissions

A trinary, role-based permission system designed so one platform can fit marinas that organize their staff completely differently — without any code changes.

## Roles vs. Permissions

- A **Role** is a named bundle of permission settings (e.g. "Security," "Office," "Night Manager"). Marinas start with sensible defaults and can add, edit, duplicate, or delete roles freely.
- A **User** can hold **multiple roles** at once. This is the mechanism for staff who wear more than one hat — an office manager who also triages maintenance tickets simply holds both the Office and Maintenance roles, rather than needing a special combined role maintained by hand.
- Permissions are **unscoped**: a permission applies globally across the marina's data. There is no per-record or per-department scoping (e.g. "assign ticket to others" is not limited to tickets of a particular category) — this is a deliberate simplicity constraint. All tickets are maintenance tickets; there's no sub-typing that would require scoped permissions.

## The trinary model

Each permission, on each role, is set to one of three values:

- **Allow** (`✓`) — this role explicitly grants the permission.
- **Deny** (`✕`) — this role explicitly revokes it, overriding any Allow from another role.
- **Undefined** (empty) — this role has no opinion, and contributes nothing to the computation.

### How a user's effective permissions are computed

For each permission, evaluated independently:

1. Start from a default of **Deny**.
2. Apply **Allow** from any of the user's roles that has it set to Allow.
3. Apply **Deny** from any of the user's roles that has it set to Deny — this cancels an Allow from step 2, even if another role allowed it.
4. Undefined never changes the outcome; it simply means that role isn't a factor for that permission.

> **In short: Deny always wins.** If a user holds two roles and either one explicitly denies a permission, the user does not have it — regardless of how many other roles allow it. This makes Deny a reliable way to carve out an exception (e.g. a trainee who holds the full Security role but should not yet have "assign ticket to others") without editing the base role.

### Worked example

A user holds both the **Security** role and a marina-specific **Trainee** role:

| Permission | Security role | Trainee role | Effective result |
|---|---|---|---|
| Create incidents | ✓ |   | **Allow** — only Security has an opinion. |
| Assign ticket to others | ✓ | ✕ | **Deny** — Trainee's explicit Deny cancels Security's Allow. |
| View contact info |   |   | **Deny** — default, since nothing allowed it. |

## Permission list

The full, fixed catalog of permissions. Marinas cannot invent new permissions, but can assign the existing ones to as many custom roles as needed.

| Permission | Governs |
|---|---|
| `create_incidents` | Creating new incidents, and adding comments/addendums to any incident. (Editing an incident's original content is limited to its author until end of their shift, regardless of this permission.) |
| `view_incidents` | Seeing incidents in lists/reports, and seeing the incident link from a ticket that was raised from one. |
| `assign_ticket_to_self` | Taking an unassigned ticket for oneself. |
| `assign_ticket_to_others` | Assigning a ticket to another user. |
| `view_owner` | Seeing that a slip/boat has an associated owner and their name. |
| `view_contact` | Seeing an owner's or contact's phone/email details (separate from just knowing who they are). |
| `edit_owner_contact` | Editing owner and contact records. |
| `view_lease` | Viewing lease/contract details, variances, and documents. |
| `manage_lease` | Creating and editing lease/contract records. |
| `manage_checklists` | Creating and editing checklist templates (global and role-scoped; personal templates are always editable by their creator regardless of this permission). |
| `manage_users` | Inviting, editing, and deactivating user accounts. |
| `manage_roles` | Creating, editing, duplicating, and deleting roles and their permission settings. |
| `place_calls` | Initiating outbound calls/SMS from the Comms section. |
| `view_calls` | Seeing call history and detail — the call log, matched contact/notes/recording/transcript on a call. Independent of `place_calls`: a user can be able to see calls without being able to make them, or vice versa. |
| `view_sms` | Seeing SMS threads and their message history. Independent of `place_calls` the same way. |
| `view_reports` | Access to the Reports section. |
| `view_all_chats` | Seeing every chat room, not just ones you're invited to. View-only — does not grant the ability to send messages in a room you aren't actually a participant of. |
| `manage_chats` | Adding yourself, or another user, as a participant to any chat room — regardless of whether you were originally invited. This is what lets a manager or department head join an in-progress conversation, or place someone else into one. |
| `manage_assets` | Creating/editing assets, maintenance rules, and checkout records. |
| `manage_locations` | Creating/editing locations, location types, and checkpoints. |
| `manage_reservations` | Creating/editing reservations and overriding status/dates. |
| `manage_marina_settings` | Editing the MarinaSettings record: retention policy, GPS defaults, phone lines, recording toggle. |

The last five were identified while writing out [Role Workflows](workflows.md) and the page specs — implied by features but not present in the original list — and are now confirmed as part of the fixed catalog.

## Ticket creation is allowed by default for all roles

Per the original requirement, every role can create a maintenance ticket by default — there is deliberately no `create_ticket` permission in the list above. If a future need arises to restrict this for a specific marina, it would need to be added as a new permission rather than repurposing an existing one, since the current design treats ticket creation as a baseline capability of the system rather than a gated one.

## Admin visibility

The **Admin** section of the app (see [Page Specifications](pages/index.html)) is only shown in navigation to a user holding at least one of the "manage_*" permissions. Within Admin, each sub-section (Users, Roles, Checklist Templates, Location Types, Marina Settings, etc.) is independently gated by its own corresponding permission.

## Enforcement

Where a permission is checked matters more than what it grants. There are
three tiers now, where the previous stack had two and the second was empty.

> **Status.** Target design. See [ADR 0005](adr/0005-supabase-and-powersync-replace-instantdb.md).

### Resolving the acting user

Every policy starts from one function. Clerk is a third-party auth provider to
Supabase, so the JWT's subject is the Clerk user id and nothing else — roles
and permissions are deliberately *not* claims:

```sql
create function current_marina_user_id() returns uuid
  language sql stable security definer set search_path = public
as $$
  select id from public.users
  where clerk_user_id = auth.jwt() ->> 'sub'
    and active
$$;
```

It returns null for a Clerk identity with no active marina User — an outsider,
or a deactivated account. Every policy below fails closed on null, so
deactivating a user is a complete revocation rather than a UI change.

### Effective permissions, in SQL

The trinary computation translates directly, and `EXCEPT` *is* deny-wins:

```sql
create view effective_permissions as
      select ur.user_id, p.permission
        from user_roles ur
        join roles r on r.id = ur.role_id
        cross join lateral unnest(r.allow) as p(permission)
  except
      select ur.user_id, p.permission
        from user_roles ur
        join roles r on r.id = ur.role_id
        cross join lateral unnest(r.deny) as p(permission);

create function has_permission(perm text) returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.effective_permissions
    where user_id = public.current_marina_user_id()
      and permission = perm
  )
$$;
```

**The two denormalized booleans disappear.** `canManageRoles` and
`canManageUsers` existed only because an InstantDB rule could reach a scalar
attribute in a single hop and nothing further. A view can join. Deleting them
also deletes the cache-invalidation cascade the Admin screens had to run
whenever a role's grants or a user's role links changed — that is a class of
bug removed, not relocated.

### Tier 0 — every table

`current_marina_user_id() is not null`. An active marina User, or nothing.

### Tier 1 — server-enforced

| Table | Read gated by | Write gated by |
|---|---|---|
| `incidents`, `incident_comments` | `view_incidents` | `create_incidents` |
| `contacts` | `view_owner` | `edit_owner_contact` |
| `contact_details` | `view_contact` | `edit_owner_contact` |
| `leases`, `lease_comments` | `view_lease` | `manage_lease` |
| `calls`, `call_notes` | `view_calls` | `place_calls` |
| `sms_threads`, `sms_messages` | `view_sms` | `place_calls` |
| `roles` | Tier 0 | `manage_roles` |
| `users` | Tier 0 | `manage_roles` or `manage_users` |
| `user_roles` | Tier 0 | `manage_roles` |
| `activity_log_entries` | Tier 0 | insert always; update only the Protected flag; **delete never** |

### The privilege-escalation vector closes structurally

[ADR 0002](adr/0002-client-side-permission-enforcement.md) records a residual
gap in two vectors: an active user could set `canManageRoles` on their own
row, or link their own row to an existing admin Role, because InstantDB's
`update` was per-entity rather than per-field or per-link.

Both vanish here, and not by being carefully patched:

- The booleans no longer exist, so there is nothing to set.
- Role assignment is a row in `user_roles`, which is **its own table with its
  own policy**. Granting yourself a role is an `INSERT` requiring
  `manage_roles`. There is no per-entity update that reaches it.

This is the acceptance criterion ADR 0005 carries forward from Phase 4, and
it is satisfied by the data model rather than by a rule.

### The field-level problem

`view_owner` and `view_contact` are two permissions over **the same row,
different columns** — knowing an owner's name versus seeing their phone and
email. RLS is row-level; it cannot express that.

The model resolves it by splitting the row: `contacts` holds identity (name,
matched phone number for display), `contact_details` holds the reachable
details (phone, email, address) as a separate table keyed 1:1. Two tables,
two policies, two sync streams — and a user with `view_owner` but not
`view_contact` simply never receives the details rows at all, offline or on.

The alternative — one table, columns nulled by a view — fails the offline
requirement, because a device would have to hold the row it isn't allowed to
read. Splitting is what makes the boundary hold on a phone in a dead zone,
not just in a query.

### Tier 2 — client-side only

Everything else: `assign_ticket_to_self`, `assign_ticket_to_others`,
`manage_checklists`, `view_reports`, `view_all_chats`, `manage_chats`,
`manage_assets`, `manage_locations`, `manage_reservations`,
`manage_marina_settings`.

These gate what the interface offers, not what the database permits. That is a
deliberate stopping point rather than an oversight: they govern *marina
configuration*, where every holder is staff, the data is not sensitive, and
the cost of a mistake is a bad checklist template rather than exposed guest
information. Tier 1 was drawn around the data a guest would care about being
leaked.

> **What that means in practice.** The Supabase anon key ships in the browser
> bundle, by necessity. It grants nothing on its own — RLS evaluates against
> the Clerk JWT — but a signed-in staff member can still write configuration
> tables their roles say they shouldn't. That is a smaller surface than the
> previous stack, where *every* table was readable and writable by any active
> user, but it is not zero, and it is recorded rather than implied.

### Sync scoping reads the same tables

The device only receives rows a sync stream sends it, and the streams resolve
the acting user exactly as RLS does — a parameter query against the database,
not a token claim:

```sql
-- parameter query: who is asking
SELECT id AS user_id FROM users
 WHERE clerk_user_id = request.user_id() AND active
```

Tier 1 tables are then streamed conditionally on `effective_permissions`, so
an unauthorized row never reaches the device in the first place. RLS remains
the backstop that makes the boundary true for direct writes; the stream is
what makes it true for reads on a phone with no signal.

Because both read the same tables, there is **one authorization model rather
than two that can disagree**, and a role change takes effect on the next
reconnect without waiting for a token to refresh.
