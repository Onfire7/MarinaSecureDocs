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

Where a permission is checked matters more than what it grants, and the two
halves are very unevenly divided.

**Enforced by InstantDB's permission rules (server-side).** Every namespace
requires a signed-in Clerk identity that resolves, through the `userAuth`
link created on first sign-in, to an **active** marina User. Writes to
`roles` require `manage_roles`; writes to `users` require `manage_roles` or
`manage_users` to create, with a narrow own-row bootstrap so a first sign-in
can claim its record. `activityLogEntries` can be updated but never deleted
from a client. Runtime attribute creation is denied outright.

Those checks read two denormalized booleans on the User record —
`canManageRoles` and `canManageUsers` — rather than the role grants
themselves, because a rule can only reach a scalar attribute in a single
hop. The application never reads those booleans; it always computes
permissions live from roles. They exist solely so the rules can see them.

**Enforced in the UI only (client-side).** Everything else. `view_incidents`,
`manage_locations`, `view_owner`, `place_calls` and the rest are checked when
rendering and when initiating a write, and not at all by the database.

> **What that means in practice.** The InstantDB app id ships in the browser
> bundle, by necessity. Anyone signed in as an active marina User can
> therefore read and write any namespace directly, regardless of which
> permissions their roles grant. The permission system above is a
> well-formed model of what staff are *meant* to do, and it is what the
> interface obeys — but for anything beyond "is this an active staff
> member", it is not a security boundary.

This is a deliberate, recorded acceptance rather than an oversight: closing
it needs either per-field and per-link rules whose semantics are not yet
settled, or moving those writes behind a trusted server endpoint that does
not exist. See [ADR 0002](adr/0002-client-side-permission-enforcement.md)
for the reasoning and the known residual gap.
