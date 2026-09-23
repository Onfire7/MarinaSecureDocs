# Finding page

`/audits/:id/targets/:targetId` — one target of one audit. `/audits/:id/propose`
— the same form with no target, proposing a new location.

Behaviour is `docs/audits.md` § Field work. This file records what the page
itself commits to.

- **Built-in questions by kind.** Occupancy: *Occupied?*, then boats (types
  with `has_boat`), vehicles (`has_vehicle`) and an optional Contact.
  Status, each section shown only when its audit's category is on, in this
  order: each valid Attribute (value / note, no present/absent — it always applies;
  always a Proposal, including clearing a value) — a number field with its
  unit, or a select of its options when its kind is `choice` — each valid
  Service
  (present / working / note), each valid Amenity (present / note),
  *clearly marked?*, *placed correctly on the map?*. A proposed new
  location (no target) always shows Attributes, Services and Amenities,
  ignoring category flags — they don't apply to data entry on something
  that doesn't exist yet. Both kinds: Status select (applies at once), the
  target's own questions, the GPS block, *Propose a change*, the
  Ticket / Incident / Note actions.
- **The form opens pre-filled from what the location already records** —
  services present with their working flag and note, amenities, attribute
  values, the current status. An audit verifies; it does not re-enter a
  location from scratch, and an untouched section proposes nothing. The seed
  waits for every catalogue, validity and location query to settle, on the
  same both-flags rule reopening uses below.
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
- **Reopening a finding restores everything it recorded** — occupants,
  services, amenities, attributes, answers, the placement and GPS
  proposals. The form seeds only once, and only after the finding row *and*
  all six of its part queries have settled (`isLoading` and `isFetching`
  both false); a parameter change on a PowerSync query keeps the previous
  empty data and does not flip `isLoading`, which is what once made a
  reopened finding come up blank.
- **The map is shown** under *placed correctly on the map?*: the map the
  location is plotted on with its rectangle highlighted and the rest muted, or
  its nearest ancestor's map when it is plotted nowhere. *Move it on the map*
  (or *Place it*) arms a tap on the image; the tap becomes a `move_placement`
  Proposal drawn in amber with the location's plain name (no "(proposed)"
  suffix, so the label is the size the finished map will show), and answers
  the question No. The Yes/No buttons sit beside the question, above the
  map, not below it. *Adjust the label*
  opens the same four sliders the admin map editor has (font size, padding,
  rotation) on the proposed placement, and *Move again* re-arms the tap, so a
  wrong label can be put right from the field, not only reported.
