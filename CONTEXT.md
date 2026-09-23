# MarinaSecure

The domain language of MarinaSecure — a security, maintenance, and operations
system deployed independently for each marina it serves.

This file is the glossary and nothing else. It defines what each term *is*.
Structure, fields, and rationale live in `docs/`; decisions live in
`docs/adr/`.

## Deliberately overloaded terms

Marina vocabulary reuses a few words in different senses. Always make the
sense clear from context:

- **Check-in** — (1) a guard checking in at a Checkpoint; (2) a guest's
  arrival that begins a Reservation; (3) an Asset being returned after
  checkout. Note the inversion: an asset's reservation *begins* when the
  asset is checked out.
- **Check-out** — (1) taking an Asset; (2) a guest's departure that ends a
  Reservation.
- **Owner** — (1) the predefined Owner role; (2) a boat owner, a Contact in
  a boat's ownership succession.

## Core

**Marina**:
A single customer of the platform, deployed in full isolation — its own
subdomain, site, database, and telephony account.
_Avoid_: tenant, instance, client

**Location**:
Any physical place the system tracks, nestable under another Location.
_Avoid_: place, site, area

**Location Type**:
An admin-defined category of Location that declares which types it may nest
under and what capabilities its Locations have.

**Root Location**:
A Location with no parent, representing a property the marina manages. A
marina managing two properties has two.

**Slip**:
A Location where a boat is moored; the most common unit in the system.
_Avoid_: berth, mooring, dock space

**Marina Map**:
An admin-uploaded schematic of a Location's layout, onto which its child
Locations are plotted. Not a real-world geographic map.
_Avoid_: site plan, diagram

**Reservable**:
A Location or Asset that accepts Reservations — a capability its type
permits and its own settings enable.

**Leasable**:
A Location that can be subject to a Lease — defined the same two-level way
as Reservable. A Location may be both.

**Boat**:
A vessel tracked by the system, with an ownership succession and an
optional Slip.

**Vehicle**:
A car, truck, trailer, or RV tracked by the system, optionally occupying a
Location.

**Haul-Out**:
Removing a boat from the water. A marina-performed haul-out raises a
Ticket; a customer-performed one doesn't.

**Asset**:
A tracked piece of equipment that needs regular maintenance, can be checked
out, or both. Static infrastructure with neither is not an Asset.

## Checkpoints & checklists

**Checkpoint**:
A specific physical place a guard checks in at, tied to a Location and to
GPS coordinates that validate the check-in happened nearby.

**Manual Check-In**:
A check-in performed without scanning the tag or code. Always requires a
recorded reason.

**Tour**:
A set of Checkpoints a guard is expected to visit during a Shift, in one of
three modes: Linear, Freeform, or Randomized.
_Avoid_: route, patrol, round

**Checklist Template**:
The reusable definition of a checklist. Each Template is owned by exactly
one Role, and may name further Roles that can watch its progress.
_Avoid_: checklist type, form

**Section**:
An ordered group of Items within a Template, and the unit a Checkpoint
attaches to — scanning a Checkpoint opens the Sections that name it.

**Checklist**:
A specific in-progress or completed instance of a Template — the record of
what was checked at a point in time.
_Avoid_: checklist run, submission

**Trigger**:
The event that creates a Checklist or Section: Manual, Clock In, Clock Out,
Checkpoint Visit, or Recurring.

**Simple Check**:
The most basic item type — marked complete, no further detail.

**Verify Task**:
An item representing work done by someone else, which the guard confirms,
rejects with a reason, or rejects with a Ticket.

**Door Check**:
An item recording a door's state — Open, Unlocked, or Locked — as found and
as left, against an expected state. There is no "Closed" state; Unlocked
and Locked both imply it.

**Lock Check**:
A Door Check for something with a lock but no door — a padlocked gate, a
fuel pump, a shed hasp. Records only Locked or Unlocked.

**Location-Based Check**:
An item that branches into its own nested checklist scoped to a specific
Location.

**Meter Reading**:
An item that records an Asset's meter value, feeding that Asset's
maintenance rules.

## Audits

**Audit**:
A review of a set of Locations, launched by a User with permission to do so,
worked in the field by the Users and Roles assigned to it, that reconciles
what the system records with what is actually there. Never used alone for
the Activity Log.
_Avoid_: survey, walk, inspection, census

**Occupancy Audit**:
An Audit of who and what occupies each Location — the boat or vehicle
present, and whether anyone is there at all.

**Vacancy Audit**:
An Occupancy Audit whose Audit Rules select only Locations recorded as
vacant. Not a third kind of Audit.

**Status Audit**:
An Audit of the Locations themselves rather than their occupants: which
Services and Amenities are present and working, whether the Location is
correctly marked and mapped, and whether the marina delivers what it
promises there.

**Audit Template**:
The reusable definition of an Audit: its kind (Occupancy or Status), its
tree of Audit Rules, and the Audit Questions attached to them. Launching
copies it onto the Audit, so edits made at launch never reach the Template.

**Audit Rule**:
A node in an Audit Template's tree that selects Locations by their type,
ancestry, status, name, Services, Amenities, occupancy or audit history.
A child Rule narrows its parent; the Audit Questions attached to a Rule are
asked only of the Locations it selects.
_Avoid_: location group, filter, scope

**Audit Question**:
A marina-defined question attached to an Audit Rule, answered per Location:
Yes/No (optionally raising a Ticket on No), Choice, Text, or Meter Reading.
The built-in questions of an Audit's kind are not Audit Questions.

**Finding**:
What one User recorded about one Location in one Audit: the built-in
answers, the Audit Question answers, and any Proposals.
_Avoid_: result, response, submission

**Proposal**:
A change recorded in a Finding that waits for approval when the Audit is
finalized rather than applying at once: a new Location, a removal, a change
to name, type, parent or map placement, a GPS coordinate, or the presence of
a Service or Amenity.
_Avoid_: pending change, request

**Audit Report**:
The document compiled from one Audit for reading outside the app - headline
numbers, an executive summary in sentences, what needs attention, and the
results per Location and per item. Compiled live while the Audit is Open or
Closed; stored at finalize and never changed after.
_Avoid_: results page, summary, export

**Share Link**:
A public URL to an Audit Report whose random key is the whole credential.
One per recipient; labelled, expiring, revocable, and counted.
_Avoid_: public link, guest link, token

**Unexpected Occupancy**:
A Finding that a Location is occupied with no current Lease or active
Reservation on file, or vacant when one is.

**Retired Location**:
A Location whose removal an Audit approved. Hidden from pickers, maps and
Audits; its history and attachments are kept. A Location with no history is
deleted instead.

**Service**:
A fixed utility delivered at a Location — power of a given amperage, water,
sewer — whether metered or not.
_Avoid_: hookup, utility

**Amenity**:
An extra a Location offers beyond its Services — WiFi, a fire pit, a grill,
a picnic table. A parent Location's Amenities apply to its children without
being recorded on them.
_Avoid_: feature, facility, extra

**Attribute**:
A fact a Location enforces about what it will accept — a number with a unit
(maximum boat length), or a choice from options the marina defines (a
campsite being back-in or pull-through). Unlike a Service or Amenity, an
Attribute is never present or absent: it applies to every Location of a
valid type, and only its value is optional. Once an Audit exists for a Location, its Attribute
values change only through an approved Proposal — there is nothing to
toggle without review.
_Avoid_: spec, limit, restriction

## Incidents, tickets & notes

**Note**:
A freeform log entry attached to exactly one Location, Checkpoint, Boat,
Vehicle, Contact, or Asset. Carries no status or priority.

**Incident**:
A logged occurrence not fully covered by a Note or Ticket — a security
concern, property damage, anything notable. Its original content locks at
the end of its author's Shift.

**Addendum**:
A timestamped addition to an Incident after its original content has
locked. The original record is never altered.
_Avoid_: edit, revision, incident comment

**Ticket**:
A unit of maintenance work, with a priority and an optional link back to
the Incident that spawned it.
_Avoid_: work order, job, task

**Attachment Target**:
The single Location, Checkpoint, Boat, Vehicle, Contact, or Asset that a
Note, Incident, or Ticket is attached to. Never freeform, never more than
one.

## Assets & reservations

**Meter**:
A numeric reading on an Asset — mileage or hours — that drives scheduled
maintenance.

**Maintenance Rule**:
A condition on an Asset that raises a Ticket when met, based either on
elapsed time or on accrued meter value.

**Asset Status**:
An Asset's current condition, drawn from an open admin-defined set (In
Service, Needs Cleaning, Out of Service, …), tracked as a running history.

**Checkout**:
A record of an Asset being signed out and returned, naming who processed
it and who took it.

**Reservation**:
A booking of a reservable Location or Asset. An upcoming Reservation never
changes its target's status; only becoming active does.
_Avoid_: booking, hold

**Post-Reservation Status**:
The status a target lands in when a Reservation completes — a cabin to
"Needs Cleaning," a jump pack to "Needs Charging."

## People

**Contact**:
Any person or entity tracked in the system who isn't necessarily a User.
_Avoid_: customer, person, account

**Owner**:
A Contact associated with a Boat, listed in order of succession.

**Authorized User**:
A Contact permitted to use a specific Boat, distinct from its Owners.

**Lessee**:
A Contact party to a Lease.

**Lease**:
An agreement tying one or more Lessees to a leasable Location, with dates,
documents, and a comment thread.
_Avoid_: contract, rental agreement

**Variance**:
A documented exception to a standard lease or slip condition — a boat
exceeding a slip's normal size limit, for example.

**User**:
An authenticated staff account. Every User holds one or more Roles.
_Avoid_: staff member, employee, guard (except when specifically on patrol)

## Access

**Role**:
A named set of permission grants. A User may hold several at once.

**Permission**:
A single grantable capability, held as Allow, Deny, or Undefined. Deny
always wins; Undefined means no opinion.

**Admin**:
The configuration area of the app, visible to anyone holding permission to
at least one of its sections.

## Shifts & reporting

**Shift**:
A period of active duty for one guard, started and ended from the
dashboard. Other records associate with it by timestamp, not by link.

**Shift Report**:
The end-of-shift summary compiled when a Shift ends, delivered to a
marina-configured distribution list.

**Activity Log**:
The immutable, chronological record of changes, generated as a byproduct of
nearly every change.
_Avoid_: audit trail, audit log (an Audit is a field review, not this)

**Protected**:
A flag on an Activity Log entry exempting it from the marina's retention
purge.

## Communications

**Comms**:
The section covering Calls, SMS, and Chat Rooms.

**Line**:
One of the marina's public, advertised phone numbers. Individual staff
extensions live on the marina's own PBX and are outside this system.

**Chat Room**:
An internal-only messaging thread between invited Users and Roles.
Unrelated to Calls or SMS.

**SMS Template**:
A saved, reusable message body, available marina-wide or per User.

**Missed Comms**:
The running count of missed calls and unread messages, surfaced as a
floating badge.
