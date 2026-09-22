# Finding page

`/audits/:id/targets/:targetId` — one target of one audit. `/audits/:id/propose`
— the same form with no target, proposing a new location.

Behaviour is `docs/audits.md` § Field work. This file records what the page
itself commits to.

- **Built-in questions by kind.** Occupancy: *Occupied?*, then boats (types
  with `has_boat`), vehicles (`has_vehicle`) and an optional Contact.
  Status: each valid Service (present / working / note), each valid Amenity
  (present / note), *clearly marked?*, *placed correctly on the map?*.
  Both: Status select (applies at once), the target's own questions, the GPS
  block, *Propose a change*, the Ticket / Incident / Note actions.
- **Unexpected occupancy** is derived live from the Lease and checked-in
  Reservation on file and shown as a badge; it is never asked.
- **Occupant search never erases what was typed.** Picking a boat after typing
  a registration the record lacks offers *Update record*, per field.
  No match offers *Create*. Boats and Contacts created here are real rows.
- **GPS block** appears only when the pin is missing or the device is farther
  than the marina's audit radius. Capture needs the *I am standing directly
  at* checkbox and device accuracy within the marina's limit; the fix is a
  Proposal, not a write.
- **Save** writes one transaction through `saveFinding()`, then raises a
  Ticket for every *ticket on No* question answered No, and records meter
  readings for metered services. It then returns to the audit.
- **Read only** when the audit is not open, or the finding belongs to someone
  else. A colleague who disagrees uses *+ Note*.
- **The map is shown** under *placed correctly on the map?*: the map the
  location is plotted on with its rectangle highlighted and the rest muted, or
  its nearest ancestor's map when it is plotted nowhere. *Move it on the map*
  (or *Place it*) arms a tap on the image; the tap becomes a `move_placement`
  Proposal drawn in amber, and answers the question No.
