# Occupancy lives on the boat and vehicle, not on the location

`locations.current_boat_id` and `current_vehicle_id` were unique foreign keys:
one boat per slip, one vehicle per site, enforced by the database and recorded
in `docs/data-model.md` as deliberate exclusivity. The location audit design
(2026-09-22) reverses this: `boats.location_id` and `vehicles.location_id`
point at the place, and a location may hold any number of either.

The decision was forced by the field, not by modelling taste. A campsite is
routinely occupied by a car and a trailer; a slip by a boat and its dinghy; a
boathouse by several boats. An auditor standing at the site must be able to
record what is actually there, and the one-occupant columns made the second
vehicle unrepresentable. Keeping the exclusive column and adding a junction
for "extra" occupants was considered and rejected: two representations of the
same fact, with the exclusive one silently wrong whenever the junction is
used.

**Consequences.** The "one boat, one slip" uniqueness is gone. A boat still
has at most one location, so a boat recorded in a new slip still vacates its
old one; the audit records that as a finding on the old slip when it is in
the same audit. `src/data/boats.ts` owns the move and haul-out writes and is
the only module that changes them. Anything that read `current_boat_id` to
answer "is this slip occupied" now reads the location's status or counts its
occupants.
