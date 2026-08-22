# Data Model

Every entity tracked by the system, its fields, and how it relates to everything else. This describes schema-level structure and intent — not InstantDB query code.

> **Reading these tables.** Field types are described in plain terms (text, number, date, boolean, reference). A field marked `ref → Entity` is a relationship to another entity, and `ref[] → Entity` is a relationship to many. Fields aren't exhaustive of every UI nicety — see individual [page specs](pages/index.html) for form-level detail.

## Attachable entities pattern

Notes, Incidents, and Tickets all follow the same attachment rule described in [Terminology](../CONTEXT.md): each attaches to **exactly one** of a fixed set of target types — Location, Checkpoint, Boat, Vehicle, Owner/Contact, or Asset — never freeform, and the set of valid target types may grow as new needs are identified. Rather than repeat this per entity below, it's called out once here and referenced as "Attachment Target" in each entity's field list.

## People & Access

### User, Role & Permissions

#### User  _(core)_

| Field | Type | Notes |
|---|---|---|
| name | text |   |
| email / phone | text | Mirrors the identity Clerk holds for this user; see [Architecture](architecture.md). |
| clerk_user_id | text | Clerk's own user ID, linking this record to its Clerk identity. Set on first sign-in; used to resolve InstantDB's verified auth identity back to a `User` record. |
| roles | ref[] → Role | A user may hold multiple roles simultaneously. |
| active | boolean | Deactivated users are hidden from assignment pickers but preserved for historical records. |
| contact | ref → Contact | Optional link so a User can also be reached as a Contact (e.g. for asset checkout). |
| dashboard_layout | structured, nullable | Ordered list of `{card, visible}` pairs for the [Dashboard](pages/dashboard.html). Null means "use the default derived from this user's current roles" — only set once a user actually customizes their layout. |
| can_manage_roles / can_manage_users | boolean, nullable | Denormalized copies of this user's effective `manage_roles` / `manage_users` permissions (see [Permissions](permissions.md)), rewritten by Admin → Roles/Users whenever a role's grants or this user's role links change. Exists only so the server-side permission rules can check them in a single hop; the app itself always computes permissions live from `roles`. |

#### Role  _(core)_

| Field | Type | Notes |
|---|---|---|
| name | text | e.g. "Security," "Maintenance," "Office," "Marina Manager." Admin-editable; can be duplicated or removed. |
| allow / deny | list of Permission, nullable | The permission keys this role grants and explicitly denies. A key absent from both is Undefined. See [Permissions](permissions.md) for the full list and effective-value computation. |

Permission values themselves aren't a separate top-level entity with rows per user — they're a fixed, admin-editable list (see [Permissions](permissions.md)) applied as two lists on each Role.

## Locations & Checkpoints

### Location & LocationType

#### LocationType  _(admin-defined)_

| Field | Type | Notes |
|---|---|---|
| name | text | e.g. "Dock," "Slip," "Cabin," "Building," "RV Site." |
| valid_parent_types | ref[] → LocationType | Which type(s) a Location of this type may nest under. A type may allow more than one valid parent. |
| allows_reservations | boolean | Whether Locations of this type _can_ be configured to accept reservations at all — a type-level capability flag. Whether a specific Location of that type actually does is a separate, per-instance toggle (see `Location.reservation_enabled` below). |
| has_boat | boolean | Whether Locations of this type hold a boat (e.g. a Slip). Drives whether `Location.current_boat` applies, and lets reservations distinguish boat-appropriate locations from others. |
| has_vehicle | boolean | Whether Locations of this type hold a vehicle (e.g. an RV Site, a parking spot). Not exclusive with `has_boat` — some leased locations can hold either one. |
| tracks_status | boolean | Whether Locations of this type carry a `status` at all — not occupancy specifically, since `status` is an open set and a type might only ever be Out of Service. A Slip or Cabin does; a purely organizational container — a root "Property," a "Dock" that only groups slips — doesn't, and showing it "Vacant" would be meaningless. Locations of a type without this flag have no `status` value and no status control anywhere in the UI. |

#### Location  _(core)_

| Field | Type | Notes |
|---|---|---|
| name / label | text | e.g. "Slip 14," "Dock C." |
| type | ref → LocationType |   |
| parent | ref → Location | Optional; must match one of type's valid_parent_types. |
| status | enum, nullable | Occupied / Vacant / Reserved / Out of Service / Needs Cleaning, plus admin-defined additions. Present only when the Location's `type.tracks_status` is true — a container type's Locations simply have none, rather than defaulting to a misleading "Vacant." |
| reservation_enabled | boolean | Whether _this specific_ Location accepts reservations at all. A simple per-location toggle in that location's own settings, deliberately independent of its siblings — this is what makes mixed-use possible: on a single Dock, the front half of Slips can have this on (short-term rentals) while the back half have it off and are tied to a Lease instead (long-term). Only meaningful when the Location's `type.allows_reservations` is true. Not hard-exclusive with having a `Lease`: turning this on for a Location with an active Lease (and, symmetrically, creating a Lease for a Location that's reservation-enabled) is allowed but triggers a warning in the UI — see [Admin — Location Types & Locations setup](pages/admin-locations.html) and [Lease Detail](pages/lease-detail.html). |
| reservation_visibility | enum: Public / Internal, only when reservation_enabled | The _default_ billing type for new reservations on this Location — Public defaults them to Billable, Internal to Non-Billable. Each reservation's own `billing_type` is chosen at booking time and is what actually governs its billing fields, so a mixed-use target (a pavilion booked by customers and staff alike) never needs its configuration flipped — see Reservation below. |
| post_reservation_status | ref → status value | What status this Location is set to when a reservation checks out. Defaults to **"Needs Cleaning"** for reservation-enabled Locations; editable per location (`manage_locations`) — a location that's usable again the moment a reservation ends (e.g. a pavilion) sets this back to Vacant instead. |
| gps_coordinates | lat/lng | Real-world coordinates, used as the default position for any Checkpoint at this location and for the geographic (pin) map view. Distinct from a Location's plotted position on a schematic `MarinaMap` — see below. |
| current_boat | ref → Boat | Applicable when `type.has_boat`; nullable. |
| current_vehicle | ref → Vehicle | Applicable when `type.has_vehicle`; nullable. A location whose type has both flags holds whichever is present. |
| notes | ref[] → Note | Attachment target. |

#### MarinaMap  _(admin-defined)_

| Field | Type | Notes |
|---|---|---|
| name | text | e.g. "Marina Overview," "Dock C Detail." |
| image | file | The uploaded layout/diagram, admin-provided — not a real-world map. Plotted rectangle coordinates (see `LocationMapPlacement`) are relative to this image. |
| scope | ref → Location, required | Every map is scoped to some Location — there's no unscoped/nullable "master map" special case. A marina's overview map is simply the map scoped to a **root Location** (a Location with no `parent`) that represents the marina/property itself; a more detailed map for one area is scoped to whichever Location it zooms in on (e.g. Dock C's own map, showing only Dock C's children). See "Root Locations" below. |

> **Root Locations.** A root Location is simply a `Location` with `parent` = null. Every marina needs at least one, representing the property itself (e.g. a `LocationType` like "Marina" or "Property," admin-defined like any other type), before it can upload an overview map — the map has to be scoped to _something_, and this is that something. A marina that manages more than one physical property as a single instance creates one root Location per property instead of forcing everything onto one image or fabricating a shared parent that doesn't really exist — this is the deliberate replacement for what used to be a single implicit "master map." When browsing the schematic map ([Location list](pages/location-list.html) or [Reservation calendar/list](pages/reservation-list.html)), the app enumerates root Locations that have a map attached: exactly one opens straight to it; more than one presents them as a top-level choice before drilling in.

#### LocationMapPlacement  _(join)_

| Field | Type | Notes |
|---|---|---|
| location | ref → Location |   |
| map | ref → MarinaMap |   |
| placement | structured (center_x, center_y, rotation, font_size, padding_x, padding_y) | Position of this Location's rectangle in the map image's coordinate space — a center point as a percentage of the image, genuinely relative so it survives any display size — plus a rotation in degrees, so a plotted slip can sit at whatever angle the dock actually runs. The rectangle's own size isn't a stored percent extent; it's intrinsic to its label (font size + padding around it), so rotation rotates a normally-proportioned box instead of stretching two independently-percent axes. Font size and padding are optional, defaulting sanely for rows plotted before this field existed. |

A join entity rather than a field on `Location`, because the same Location can be plotted on more than one map at different coordinates — e.g. Slip 14 gets a small rectangle on the property's root-level overview map _and_ a separate, more precisely-placed rectangle on Dock C's own detail map. This same plotting powers both the schematic Location map view and the Reservations map view (see [Page Specifications](pages/location-list.html)) — one shared capability, two different overlays (occupancy/type on one, reservation status on the other) drawn on top of the same rectangles.

#### Checkpoint  _(core)_

| Field | Type | Notes |
|---|---|---|
| name | text | e.g. "Dock C Gate," "Fuel Shed." |
| location | ref → Location | Every checkpoint belongs to exactly one Location. |
| guid_url | text | Unique URL containing a GUID; bound to an NFC tag or QR code. |
| gps_coordinates | lat/lng | Defaults from Location, may be refined per checkpoint. |
| gps_validation_radius | number (meters) | Overrides the marina-wide default; used to reject spoofed check-ins. |
| checklist_template_sections | ref[] → ChecklistTemplateSection | Checklist attachment is per _section_, not per template — scanning this checkpoint opens (or lazily creates) the sections that name it. |
| tours | ref[] → Tour | Tours this checkpoint participates in. |

#### Tour  _(core)_

| Field | Type | Notes |
|---|---|---|
| name | text |   |
| mode | enum | Linear / Freeform / Randomized. |
| checkpoints | ref[] → Checkpoint | Ordered for Linear mode; unordered set for Freeform/Randomized. |

#### Check-In record

Each time a checkpoint is visited, a check-in record is created (either scanned or manual):

| Field | Type | Notes |
|---|---|---|
| checkpoint | ref → Checkpoint |   |
| user | ref → User |   |
| timestamp | datetime |   |
| method | enum | Scanned / Manual. |
| reason | text | Required when method = Manual. |
| gps_at_checkin | lat/lng | Device-reported location, compared against the checkpoint's validation radius. |
| within_radius | boolean | Result of the GPS validation check; flagged for review if false. |
| generated_checklist | ref → ChecklistInstance | Nullable — not every check-in produces a checklist. |

## Checklists

### Checklist templates & instances

Templates are authored per role and organized into _sections_; instances are fully materialized copies — every section and item of an instance exists as a database row from the moment it's assigned, so display logic only ever renders rows. Two rule families govern behavior: **trigger rules decide IF a row gets created** (day/date recurrence, a checkpoint scan, a clock event), and **hide-until rules decide WHEN it becomes visible** (a time of day, resolved to a concrete timestamp at creation). Nothing ever re-hides once shown, and nothing runs in the background — every creation happens because someone used the app.

#### ChecklistTemplate  _(admin-defined)_

| Field | Type | Notes |
|---|---|---|
| name | text |   |
| assigned_role | ref → Role | Required — every template belongs to exactly one role; there is no global or personal visibility. (Personal checklists return later as their own feature.) |
| viewer_roles | ref[] → Role | Read-only cross-role monitoring — e.g. the office watching maintenance's progress without holding the role. |
| assigned_to_user | boolean | True: each instance is assigned to whoever triggered it. False: left unclaimed for any holder of assigned_role to pick up. |
| trigger_type | enum | Manual / Clock In / Clock Out / Checkpoint Visit / Recurring. Recurring instances are created by the first role-holder to open the app on a matching day (deterministic id — racing clients converge on one row). |
| trigger_config | structured | For Recurring (or as a day-gate on any type): an RFC 5545 RRULE naming which _days_ apply. Purely a calendar-day gate — time of day belongs to hide_until_rule. |
| hide_until_rule | text ("HH:MM"), nullable | Resolved to the instance's hide_until at creation. |
| due_by | structured, nullable | A rule — a clock time, or an offset from creation — resolved to the instance's due_by timestamp at creation. |
| sections | ref[] → ChecklistTemplateSection | Ordered. Items live inside sections. |

#### ChecklistTemplateSection  _(admin-defined)_

| Field | Type | Notes |
|---|---|---|
| name / order / is_active | text / number / boolean | Inactive sections are never instantiated. |
| trigger_type | enum | Manual and Recurring sections are created with the instance (Recurring only when the day matches). Checkpoint / Location / Asset sections are created _lazily_, onto an already-open instance, when that thing is actually visited. |
| trigger_config | structured | Recurring: an RRULE day rule, same semantics as the template's. |
| hide_until_rule / due_by | as on the template | Resolved onto the instance section at creation. |
| location | ref → Location | At most one — and this section's checkpoints must belong to it (enforced by the admin editor; checkpoints can't move between locations, so it can't drift). |
| checkpoints | ref[] → Checkpoint | Scanning one of these opens/creates this section. |
| assets | ref[] → Asset | Configurable now; no runtime event instantiates asset sections yet. |
| items | ref[] → ChecklistTemplateItem | Ordered. |

#### ChecklistTemplateItem  _(admin-defined · copy-on-edit)_

| Field | Type | Notes |
|---|---|---|
| type | enum | Simple Check / Verify Task / Door Check / Lock Check / Location-Based Check / Meter Reading. |
| label | text |   |
| config | structured | Type-specific: e.g. a Door or Lock Check's expected state and the required Location it belongs to (what a mismatch Incident attaches to, since neither is an entity of its own; defaulted from the section's Location on creation); Verify Task's "prompt retry after rejection" flag; Location-Based Check's nested checklist reference; Meter Reading's asset selection (a fixed Asset, or user-selected at completion time — e.g. "select your patrol vehicle"). |
| order | number | Presentation only — reorders write in place; they don't version. |
| version / previous_version | number / ref → self | Editing an item's label or config writes a _new_ row (version+1, previous_version link) and repoints the section's items link, orphaning the old row — which existing instance items still reference, so history renders exactly as instantiated without snapshotting config per instance. The chain is for debugging and a possible future history viewer; there is no forward "current" pointer. |

#### ChecklistInstance  _(instance)_

| Field | Type | Notes |
|---|---|---|
| template | ref → ChecklistTemplate | How an instance came to exist is not stored on it — the template's trigger_type says how its instances get created, and creation details go to the activity log. |
| assigned_to | ref → User | Nullable — an unclaimed role-pool instance until someone opens (and thereby claims) it. |
| status | enum | Not Started / In Progress / Complete. |
| started_at / completed_at | datetime | completed_at is the whole checklist's submission time; per-item times live on the items. |
| hide_until / due_by | datetime, nullable | Resolved from the template's rules at creation. Visible when hide_until is absent or past — permanently, once shown. |
| sections | ref[] → ChecklistInstanceSection |   |
| parent_item | ref → ChecklistInstanceItem | Set only on nested instances spawned by a Location-Based Check item; keeps sub-checklists out of the main list. |

#### ChecklistInstanceSection  _(instance)_

| Field | Type | Notes |
|---|---|---|
| template | ref → ChecklistTemplateSection |   |
| label / order | text / number | Label copied from the template section's name at creation — the one field that would otherwise need section versioning. |
| hide_until / due_by | datetime, nullable | Resolved at creation. |
| location / checkpoints / assets | refs, copied | Snapshotted from the template section at instantiation — same idea as item versioning, without versioning sections. |
| items | ref[] → ChecklistInstanceItem | Created eagerly at section instantiation — the assignment exists as rows from the start. Section completion time is _derived_ at read: the latest item completed_at, once every item has one. |

#### ChecklistInstanceItem  _(instance)_

| Field | Type | Notes |
|---|---|---|
| template | ref → ChecklistTemplateItem | Pins the exact item version this row was created from; label, type and config are always read through it, never copied. |
| order | number | Inherited from the template item at creation; the guard may reorder freely afterward — the row's own order is always what sorts. |
| result | structured | Type-specific: boolean for Simple Check; Confirmed/Rejected-Reason/Rejected-Ticket for Verify Task; for Door Check, the state _as found_ and _as left_ recorded separately (plus the Incident logged when the two differ from expected) — a door corrected on arrival must still report as having been insecure, which a single observed state cannot express. |
| note | text | Optional freeform addition. |
| linked_ticket | ref → Ticket | Set when a Verify Task fails, or a Door Check is left in a state that still isn't the expected one. |
| completed_at / completed_by | datetime / ref → User | Per-item completion time and who did it — on an hour-long checklist, when each thing happened, not just that it all happened by submission. |

## Incidents, Tickets & Notes

### Note, Incident & Ticket

#### Note  _(core)_

| Field | Type | Notes |
|---|---|---|
| author | ref → User |   |
| body | text |   |
| attached_to | ref → Location \| Checkpoint \| Boat \| Vehicle \| Contact \| Asset | Exactly one target — see attachment pattern above. |
| created_at | datetime |   |

#### IncidentType  _(admin-defined, expandable)_

| Field | Type | Notes |
|---|---|---|
| name | text | Users can add new types inline; list grows per marina. |

#### Incident  _(core)_

| Field | Type | Notes |
|---|---|---|
| title | text | Short, required. |
| type | ref → IncidentType |   |
| status | enum | Default set: Open / Under Review / Resolved / Closed, plus a Custom option (see [Role Workflows](workflows.md)). |
| details | rich text (markdown) | Optional, lightweight WYSIWYG markdown editor. |
| author | ref → User | Editable by the author only until the end of their shift. |
| assigned_to | ref → User | Optional. |
| attached_to | ref → Location \| Checkpoint \| Boat \| Vehicle \| Contact \| Asset |   |
| linked_tickets | ref[] → Ticket | Visible only to users holding "view incidents" permission when viewed from the Ticket side. |
| created_at | datetime |   |

#### IncidentComment  _(addendum)_

| Field | Type | Notes |
|---|---|---|
| incident | ref → Incident |   |
| author | ref → User | Anyone holding the "create incidents" permission. |
| body | rich text (markdown) |   |
| created_at | datetime |   |

#### Ticket  _(core)_

| Field | Type | Notes |
|---|---|---|
| title | text |   |
| description | rich text (markdown) |   |
| priority | enum | Low / Medium / High / Urgent. |
| status | enum | Open / Assigned / In Progress / Complete (admin-adjustable label set). |
| created_by | ref → User | Any role, by default. |
| assigned_to | ref → User | Requires "assign ticket to self" or "assign ticket to others" permission depending on who's assigning and to whom. |
| attached_to | ref → Location \| Checkpoint \| Boat \| Vehicle \| Contact \| Asset |   |
| source_incident | ref → Incident | Nullable — set when raised from an Incident or a failed checklist item. |
| auto_generated | boolean | True when created by a scheduled/meter-based maintenance rule (see Asset below). |
| created_at / resolved_at | datetime |   |

## Assets & Reservations

### Asset, AssetStatusLog, Checkout & Reservation

#### Asset  _(core)_

| Field | Type | Notes |
|---|---|---|
| name | text | e.g. "Security Truck #2," "Jump Pack A." |
| category | text | Admin-defined grouping. |
| has_meter | boolean | If false, hours accumulate automatically over time instead. |
| meter_type | enum | Mileage / Hours (when has_meter is true). |
| meter_reading | number | Current reading; updatable directly from the asset page. |
| maintenance_rules | structured[] | e.g. "every 3,000 miles" or "every 90 days since last completed" — each rule auto-generates a Ticket when triggered (scheduling mechanism: see [Architecture](architecture.md)). |
| checkoutable | boolean | Whether this asset supports checkout/return. |
| reservation_enabled | boolean | Whether this asset accepts Reservations at all. |
| reservation_visibility | enum: Public / Internal, only when reservation_enabled | Same default-billing-type role as `Location.reservation_visibility` — see Reservation below. |
| post_return_status | ref → status value | What status to set when the asset is checked back in — whether returning from a plain checkout or completing a Reservation (e.g. Jump Pack → "Needs Charging"). |
| current_status | text | Denormalized latest value from AssetStatusLog, for fast display. |

| Entity | Key Fields |
|---|---|
| **AssetStatusLog** | `asset` (ref), `status` (text), `note` (text, optional), `logged_by` (ref → User), `timestamp` |
| **AssetCheckout** | `asset` (ref), `checked_out_by` (ref → User, who processed it), `person` (ref → Contact, defaults to a User's linked contact), `time_out`, `time_in` (nullable while checked out) |
| **AssetMeterReading** | `asset` (ref), `value` (number), `source` (Manual entry on asset page / Checklist item), `logged_by` (ref → User), `timestamp`, `correction_reason` (text, nullable — required when `value` is lower than the asset's immediately preceding reading, e.g. a meter replacement) |

#### Reservation  _(core)_

| Field | Type | Notes |
|---|---|---|
| contact | ref → Contact |   |
| target | ref → Location \| Asset | Exactly one of the two — whichever is being reserved. |
| status | enum | Requested / Confirmed / Checked In / Checked Out / Cancelled. |
| billing_type | enum: Billable / Non-Billable | Chosen per reservation at booking time — the same pavilion is booked billably for a customer one weekend and non-billably for a staff event the next, without touching the target's configuration. Defaults from the target's `reservation_visibility`; governs whether the billing fields below exist for this reservation. |
| expected_checkin / expected_checkout | date |   |
| actual_checkin / actual_checkout | datetime | Setting actual_checkin (guest arrives / asset goes out) is what changes the target's status; setting actual_checkout (guest leaves / asset returned) sets the target to its configured post-reservation status. An upcoming reservation changes nothing — it's displayed alongside the target's status instead. |
| early_checkin / late_checkout | boolean or datetime | Ignored/hidden when this reservation's `billing_type` is Non-Billable. |
| rate / deposit / balance | currency | Ignored/hidden when this reservation's `billing_type` is Non-Billable. |

## Boats, Owners & Leases

### Boat, Contact & Lease

#### Contact  _(core)_

| Field | Type | Notes |
|---|---|---|
| name | text | Nullable temporarily — see call-matching flow in [Role Workflows](workflows.md). |
| phone | text | Used for automatic call/SMS matching. |
| email | text |   |
| merged_into | ref → Contact | Set when this contact record has been merged into another. |

#### Boat  _(core)_

| Field | Type | Notes |
|---|---|---|
| name | text |   |
| description | text | Freeform details beyond the structured fields below. |
| length / make / model | text/number |   |
| registration_number | text |   |
| owners | ref[] → Contact (ordered) | Order of succession — who to contact first. Optional: a boat's owner may simply not be known yet. |
| authorized_users | ref[] → Contact |   |
| current_slip | ref → Location | Nullable; boats are sometimes moved between slips, and history is preserved via Activity Log rather than a separate table. |

#### Vehicle  _(core)_

| Field | Type | Notes |
|---|---|---|
| description | text | The vehicle's primary label — e.g. "White Ford F-250," "Winnebago View." Freeform, since staff often only know a vehicle by sight. |
| plate_number | text | Nullable — not always readable or known. |
| owners | ref[] → Contact (ordered) | Same succession semantics as Boat. Optional: a vehicle's owner may not be known. |
| current_location | ref → Location | Nullable; the Location whose `type.has_vehicle` is true where it currently sits, mirroring `Boat.current_slip`. |

Vehicles are treated like Boats throughout: an attachment target for Notes/Incidents/Tickets, listed alongside boats in the Boats & Vehicles section (see [Vehicle List](pages/vehicle-list.html) / [Vehicle Detail](pages/vehicle-detail.html)), and occupying Locations whose type carries the `has_vehicle` flag — RV sites, parking spots, or mixed-use leased locations that can hold either a boat or a vehicle.

#### Lease  _(core)_

| Field | Type | Notes |
|---|---|---|
| location | ref → Location | Typically a Slip, but any location type that supports leasing. |
| lessees | ref[] → Contact |   |
| start_date / end_date | date |   |
| variances_and_conditions | text | Displayed alongside the Slip and Boat info it affects. |
| documents | file[] | Stored contract documents. |
| comments | ref[] → LeaseComment | Operates like a standard comment thread; each LeaseComment carries `author` (ref → User), `body` (text), and `created_at`. |

## Shifts & Audit

### Shift & Activity Log

#### Shift  _(core)_

| Field | Type | Notes |
|---|---|---|
| guard | ref → User |   |
| started_at | datetime | Set from the dashboard. |
| ended_at | datetime | Set either by submitting the end-of-shift checklist (if defined) or by manually ending the shift. |
| end_of_shift_checklist | ref → ChecklistInstance | Nullable. |
| report_sent_at | datetime |   |

Other records (checklists, incidents, tickets, check-ins) are **not** directly linked to a Shift by reference — association is computed from timestamps falling within the shift's start/end window. This avoids needing every writable entity to carry a shift reference.

#### ActivityLogEntry  _(immutable)_

| Field | Type | Notes |
|---|---|---|
| event_type | text | e.g. "ticket.created," "incident.status_changed." |
| actor | ref → User | Nullable for system-generated events (e.g. scheduled maintenance ticket). |
| subject | ref → any entity | The record the event happened to. |
| summary | text | Human-readable description, generated at write time. |
| timestamp | datetime |   |
| protected | boolean | Exempts this entry from the marina's retention purge. |

## Communications

### Call, SMS & Chat

| Entity | Key Fields |
|---|---|
| **Call** | `direction` (Inbound/Outbound), `line` (which marina number), `contact` (ref, auto-matched), `from_number`, `to_number`, `started_at`, `duration`, `recording_url` (nullable), `transcript` (nullable), `missed` (boolean), `voicemail_url` (nullable), `notes` (ref[] → CallNote) |
| **CallNote** | `call` (ref), `author` (ref → User), `body` (text), `created_at` |
| **SMSThread** | `contact` (ref, auto-matched), `line`, `last_message_at`, `unread` (boolean) |
| **SMSMessage** | `thread` (ref), `direction`, `body`, `sent_by` (ref → User, for outbound), `timestamp` |
| **SMSTemplate** | `label`, `body`, `scope` (Global / Personal), `owner` (ref → User, when Personal) |
| **ChatRoom** | `title`, `topic`, `created_by` (ref → User), `invited_users` (ref[]), `invited_roles` (ref[]) |
| **ChatMessage** | `room` (ref), `author` (ref → User), `body` (text, parsed for entity URLs to render preview cards), `attachments` (file[]), `timestamp` |

## Marina-Level Configuration

### MarinaSettings

A single settings record per marina instance, holding the configuration that lets one codebase serve very differently-run properties:

| Field | Type | Notes |
|---|---|---|
| gps_validation_radius_default | number (meters) | Marina-wide default; overridable per Checkpoint. |
| activity_log_retention_days | number | Entries older than this are eligible for purge unless `protected`. |
| call_recording_enabled | boolean |   |
| call_transcription_enabled | boolean |   |
| shift_report_recipients | text[] (emails) | Distribution list for the shift-end report. |
| phone_lines | structured[] | Each line's Twilio number, label (e.g. "Office," "Security"), and routing behavior. |
| allow_overlapping_reservations | boolean, default false | When false (the default), a new Reservation whose dates overlap an existing one for the same target is blocked outright. A marina that wants to run a waitlist/overbooking model can turn this on to allow it — see [New Reservation Form](pages/new-reservation-form.html). |
| haul_out_mode | enum: Ask / Customer, default Ask | Whether hauling a boat out (clearing its `current_slip`, see [Boat Detail](pages/boat-detail.html)) prompts for who performed it, or silently assumes a customer haul-out. A **marina** haul-out generates a Ticket for the work; a **customer** haul-out doesn't. Marinas that never haul boats themselves set this to Customer to skip the prompt entirely. |
