# Admin — Users

`/admin/users`. `manage_users`.

The only way a person enters the system: there is no self-serve sign-up
(`docs/pages/sign-in.html`). Desktop is the primary surface; this is office
work.

## The list

- One card per user: name, email · phone ("No contact info" when neither),
  and a badge per role. A user may hold several roles.
- Search matches name or email.
- Active users first, then deactivated ones, each alphabetical. Deactivated
  users stay listed, dimmed with a "Deactivated" badge: this is the screen
  that reactivates them, and their name still resolves on old Activity Log
  entries and assignments. Pickers elsewhere leave them out.
- An active user who has never signed in carries "Hasn't signed in yet".

## Actions

| Action | Behaviour |
|---|---|
| Invite user | Name (required), email (required — it is what the first sign-in is matched on), phone. Creates the `users` row with no Clerk identity; `claim_marina_user()` binds it when that person first signs in with the same verified email. Sending Clerk's invitation email needs a server-side call that isn't wired up, and the dialog says so. |
| Edit | Name, email, phone, roles, and the **Contact** (below). |
| Deactivate / Reactivate | Toggles `users.active`. Never deletes. |

## The Contact

A user may be linked to one Contact (`users.contact_id`). It is what makes
them the person on a Checkout: the Fleet card's person picker lists only
users with a Contact (`src/pages/home/FleetCard.spec.md`).

- **Search.** A searchable picker over the Contacts this device holds, by
  name, with email or phone as a second line where the device has them.
  Merged-away Contacts are not offered. Contacts reach a device only with
  `view_owner`, and only residents' (`powersync/config/sync-config.yaml`
  § occupancy_contacts), so without `view_owner` there is no picker - only
  the button below - and with it, a staff member's own Contact may simply
  not be there to find.
- **Create a contact for this user.** Shown with `edit_owner_contact`, which
  is what writing a Contact requires (RLS). Nothing is written until Save:
  Save then creates a Contact from the form's name, email and phone, and
  links it. Choosing a Contact in the picker cancels the pending create.
- **Unlink** clears the link on Save.
- A linked Contact this device doesn't hold reads "Linked to a contact this
  device doesn't hold" rather than looking unlinked, and saving leaves it
  alone.
- **Saving never clears a link it wasn't asked to.** `saveUser()` writes
  `contact_id` only when it is given one (a Contact's id, or `null` to
  unlink); otherwise it leaves the column as it is. It used to write `null`
  whenever the form didn't send one, which was always.

## States & edge cases

- **Deactivating the last `manage_users` holder** is blocked outright, with
  an explanation, not a warning. It is computed the way effective
  permissions are (`docs/permissions.md`), so holding it through any role
  counts.
- **Removing every role** is allowed: the user loses every role-gated
  feature without being deactivated.
- Saving writes nothing about what the user *may do*: `user_permissions` is
  recomputed by a trigger off the role links (ADR 0002).
