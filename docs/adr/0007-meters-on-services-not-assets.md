# A metered service carries its own meter readings

Meter readings existed only on Assets, where they drive Maintenance Rules.
The location audit design (2026-09-22) adds a second home: a Service present
at a Location (`location_services`) may be metered, and readings are recorded
against that row, not against an Asset.

The alternative was to make every slip pedestal and water riser an Asset so
the existing meter machinery could be reused. Rejected because it would
create hundreds of Assets that are never checked out and never maintained by
rule, purely to hold a number, and because the reading's meaning is
different: an Asset meter answers "when is service due", a Service meter
answers "how much did this occupant use". The second question is a billing
question, and its owner is whoever held the Lease or Reservation at the time
of the reading, which is derived later rather than stored on the reading.

**Consequences.** Units belong to the Service definition (kWh, gallons).
Readings are history only; no rule fires from them. A reading may be marked
as a meter reset so consumption is never computed across it. The two meter
kinds share no table and no code path, on purpose.
