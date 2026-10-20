# Dashboard

`/`. The Home landing screen: a customizable set of cards. Roles determine a
sensible default arrangement; each user can then show, hide and reorder any
card they have access to.

## Purpose

There is no single fixed home layout, and no free-for-all either. A card is
only offered to a user who holds whatever permission already governs the data
it displays. Roles are only a starting point: each ships a default set of
cards in a default order, reflecting what that role most needs first. A user
may hide a card, add one they are permitted but whose role doesn't default to
it, or reorder the stack; the role-derived arrangement is just what a new or
unconfigured user sees. See `docs/workflows.md` for the narrative behind each
card.

**Card permissions reuse data permissions.** A card's requirement is exactly
the permission that already controls the data it reads (Incident summary
needs `view_incidents`, the same gate as everywhere else Incidents show). No
card-specific permission exists. Where the catalogue has no view gate for a
card's data (tickets, reservations; see `docs/permissions.md`), the card needs
none, and a card that reads no marina data (Clock) is always available.

## Cards

| Card | Requires | Default for | Content |
|---|---|---|---|
| Clock | None; reads no marina data | All roles | Current time and date. |
| Shift | None; starting and ending a shift isn't permission-gated | Security | Start Shift with no active Shift; while active, elapsed time, start time, and the end-of-shift button (§ The Shift card). |
| Ticket summary | None; there is no ticket view permission | Maintenance, Office | Counts by priority and status; taps through to the Ticket queue. |
| Incident summary | `view_incidents` | Security, Marina Manager/Owner | Recent and open counts; taps through to the Incident list. |
| Missed comms badge | `view_calls` and/or `view_sms`; sums only what the user can see | Office | Missed calls plus unread SMS; opens the missed comms detail. |
| Upcoming reservations | None; there is no reservation view permission | Office, Marina Manager/Owner | Reservations with an `expected_checkin` in the near term. |
| Admin shortcuts | Any `manage_*` permission | Marina Manager/Owner | Links into the relevant Admin sections. |
| Fleet | `use_fleet`; hidden while the marina has no Fleet Vehicles | Security | The marina's own vehicles: check out and in, log mileage, fuel, Incidents and Tickets (`FleetCard.spec.md`). |

## The Shift card

**No active Shift.** **Start Shift** creates a Shift (guard = current user,
`started_at` = now). If the guard's Role has a Clock In template with
something to do, that checklist is created and opens immediately, in its own
transaction, so a failure to build it cannot undo the start of the shift.

**On shift.** One button, whose label and destination are the next step of
ending the shift. The steps and their order are specified in
`src/pages/checklists/ActiveChecklistPage.spec.md` § Ending the shift; in
order of precedence:

| Button | When | Opens |
|---|---|---|
| **Finish {checklist name}** | An open checklist of this guard's, created during this Shift, has an unanswered End Shift Item | That checklist, scrolled to the End Shift Item. Its findings are only written when it is submitted, so ending the shift around it would lose them. |
| **End of Shift Checklist** | The guard's Role has a Clock Out template with something to do now, and this Shift's End of Shift Checklist is not complete | That checklist, created and linked to the Shift if it doesn't exist yet. |
| **End of Shift Report** | Otherwise | The End of Shift review (`/shift/end`), which ends with **End Shift and Submit**. |

The shift ends only at **End Shift and Submit**. No button on this card ends
it directly.

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Start Shift | None | As above. |
| End-of-shift button | None | As above. |
| Show / hide a card | Only cards the user holds the permission for | Toggles that card for this user only; saved per user. |
| Reorder cards | Same | Drag (desktop) or long-press and drag (mobile); saved per user. |
| Reset to role defaults | None | Discards the saved layout and recomputes from the roles the user now holds. |

## States and edge cases

- **No cards available.** Shouldn't happen, since Clock needs no permission;
  the fallback shows only account info and navigation.
- **Permission revoked for a shown card.** The card drops out on next load,
  and is not restored if the permission returns; the user re-adds it or
  resets.
- **New role granted.** A customized layout is not rearranged; the new cards
  just become addable. Only an uncustomized user, or a reset, takes the
  role's defaults wholesale.
- **Shift ended offline.** The card reflects `ended_at` at once; it is a local
  write.
- **Several checklists with End Shift Items open.** The button names the
  oldest; finishing it moves on to the next.

## Mobile and desktop

Mobile stacks cards in the saved order (role order for an uncustomized user),
with the Shift card at the top for Security by default. Desktop arranges them
in a grid, in the same order and visibility. Show, hide and reorder live in
an edit mode on both, with larger drag targets on mobile.
