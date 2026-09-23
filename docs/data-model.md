# Data Model

Every table, its columns, and how it relates to everything else. Schema-level
structure and intent — not query code.

> **Status.** The relational model for Supabase Postgres, live since the
> 2026-09-22 cutover ([ADR 0005](adr/0005-supabase-and-powersync-replace-instantdb.md)).
> Where it deliberately differs from the InstantDB schema it replaced, the
> reason is stated inline under *Unwound*. § *Services & amenities* and
> § *Audits* are designed, not yet migrated.

## How to read this

- Types are Postgres types. Every table has `id uuid primary key default gen_random_uuid()` unless stated; timestamps are `timestamptz`.
- `→ table` is a foreign key. A **junction** table exists where the relationship is many-to-many or needs its own ordering.
- **Sync** is what reaches a device — see [Architecture — What is resident](architecture.md): *always* (marina configuration), *occupancy* (attached to a current lease or reservation, plus 30 days), or *age* (a recent window only).
- **RLS** is Tier 0 (any active marina user) or Tier 1 (gated by a named permission) — see [Permissions — Enforcement](permissions.md).

## The attachment target

Notes, Incidents and Tickets each attach to **exactly one** of six things —
Location, Checkpoint, Boat, Vehicle, Contact, or Asset. Never freeform.

Each of those three tables carries six nullable foreign keys and a constraint:

```sql
location_id   uuid references locations(id),
checkpoint_id uuid references checkpoints(id),
boat_id       uuid references boats(id),
vehicle_id    uuid references vehicles(id),
contact_id    uuid references contacts(id),
asset_id      uuid references assets(id),
constraint exactly_one_target check (
  num_nonnulls(location_id, checkpoint_id, boat_id, vehicle_id, contact_id, asset_id) = 1
)
```

> **Unwound.** This was six optional links with the rule enforced in
> application code — and one of seven real tickets violated it. The constraint
> makes the invariant unbreakable. That row is dropped at migration.

> **Only two arms have real data.** `location` and `asset` appear; `boat`,
> `vehicle`, `contact` and `checkpoint` have no examples anywhere. Those four
> are designed against empty tables.

## People & access

#### `users` — Tier 0 · sync: always

| Column | Type | Notes |
|---|---|---|
| name | text not null | |
| email / phone | text | Mirrors the identity Clerk holds. |
| clerk_user_id | text unique | Clerk's user id. **This is the join RLS uses**: `current_marina_user_id()` resolves `auth.jwt() ->> 'sub'` through it. |
| active | boolean not null | Deactivated users are hidden from pickers but preserved for history. A null resolution fails every policy closed. |
| contact_id | → contacts | Optional, so a User can also be reached as a Contact (asset checkout). |
| dashboard_layout | jsonb | Ordered `{card, visible}` pairs. Null = derive from current roles. Genuinely per-user UI state; stays `jsonb`. |

> **Unwound.** `can_manage_roles` / `can_manage_users` are **deleted**, along
> with the cache-invalidation cascade Admin ran on every role change. They
> existed only because a rule engine could reach one scalar in one hop.

#### `roles` — Tier 0 read / `manage_roles` write · sync: always

| Column | Type | Notes |
|---|---|---|
| name | text not null | "Security", "Maintenance", "Office". Admin-editable. |
| allow / deny | text[] | Permission keys granted and explicitly denied. Absent from both = Undefined. See [Permissions](permissions.md). |

#### `user_roles` — junction · `manage_roles` write · sync: always

`user_id → users`, `role_id → roles`, primary key on both.

> **Unwound.** This table is what closes the privilege-escalation vector in
> [ADR 0002](adr/0002-client-side-permission-enforcement.md): granting yourself
> a role is an `INSERT` here, gated by `manage_roles`. There is no per-entity
> update that reaches it.

#### `effective_permissions` — view

`(user_id, permission)`, computed allow-minus-deny across every held role. Not
a table; see [Permissions](permissions.md) for the definition.

## Locations & checkpoints

#### `location_types` — Tier 0 / `manage_locations` · sync: always

| Column | Type | Notes |
|---|---|---|
| name | text not null | "Dock", "Slip", "Cabin", "RV Site". |
| allows_reservations | boolean not null default false | |
| allows_leases | boolean not null default false | |
| has_boat / has_vehicle | boolean not null default false | Whether locations of this type hold one. |
| tracks_status | boolean not null default false | Off for organizational containers — a root property or a dock that only groups slips would otherwise read a meaningless "Vacant". |

`location_type_parents` — junction, self-referential: `parent_type_id`,
`child_type_id`. Which types may nest inside which.

#### `locations` — Tier 0 / `manage_locations` · sync: always

| Column | Type | Notes |
|---|---|---|
| name | text not null | |
| location_type_id | → location_types not null | |
| parent_id | → locations | Self-referential hierarchy. |
| status_id | → location_statuses | Null when the type doesn't track status. |
| reservation_enabled | boolean not null | Per-location switch, within the type's `allows_reservations`. |
| reservation_visibility | text | `public` / `internal`. |
| post_reservation_status_id | → location_statuses | |
| lease_enabled | boolean not null default false | Per-location lease switch, mirroring `reservation_enabled`. On one dock the front slips may be reservable and the back leasable. |
| gps_lat / gps_lng | double precision | Set through an approved audit GPS Proposal; none are set today. |
| retired_at | timestamptz | Set when an Audit's approved removal retires the Location. `useLocations`, child and holder queries filter these out; `useLocation` by id still returns one so history pages keep working. |

> **Unwound (2026-09-22).** `current_boat_id` / `current_vehicle_id`, unique
> FKs meaning "one boat, one slip", are **gone**. Occupancy is
> `boats.location_id` / `vehicles.location_id`; a location holds any number
> of either. [ADR 0006](adr/0006-occupancy-lives-on-the-occupant.md).

#### `location_statuses` — lookup · Tier 0 / `manage_locations` · sync: always

| Column | Type | Notes |
|---|---|---|
| name | text not null | "Occupied", "Vacant", "Reserved", "Out of service", "Needs cleaning", or marina-defined. |
| is_vacancy | boolean | Whether this status counts as available. |
| position | integer | Display order. |

> **Unwound.** Was a free-text `status` column on an open set. A lookup table
> gives the admin UI rows instead of migrations, lets a FK enforce validity,
> and leaves room for attributes a plain string can't carry.

#### `marina_maps` — Tier 0 / `manage_locations` · sync: always

`name`, `scope_id → locations` (not null — every map is scoped to a location;
root locations carry overview maps), `image_attachment_id → attachments`.

#### `location_map_placements` — Tier 0 / `manage_locations` · sync: always

`map_id → marina_maps`, `location_id → locations`, `placement jsonb`.

The blob is `{cx, cy, rotation, fontSize?, paddingX?, paddingY?}` — centre
point as percentages of the map image. Stays `jsonb`: it is opaque
presentation state read only by the map renderer.

#### `checkpoints` — Tier 0 / `manage_locations` · sync: always

`name`, `guid_url text unique not null` (the NFC/QR deep link target),
`location_id → locations`, `gps_lat`, `gps_lng`, `gps_validation_radius`
(metres; overrides the marina default).

#### `tours` — Tier 0 / `manage_locations` · sync: always

`name`, `mode text not null` (`linear` / `freeform` / `randomized`).

`tour_checkpoints` — junction: `tour_id`, `checkpoint_id`, `position integer not null`.

> **Unwound.** Ordering was a sibling `checkpoint_order` JSON array of ids,
> because links were unordered sets. A junction row with a `position` column
> cannot drift out of sync with its own membership.

#### `check_ins` — Tier 0 · sync: **age**

| Column | Type | Notes |
|---|---|---|
| checkpoint_id | → checkpoints, **nullable**, `on delete set null` | Null once the checkpoint is deleted. A check-in is evidence that somebody was at a place at a time; removing an NFC tag is a configuration change, not a statement that the rounds never happened. One of 151 exported check-ins is already in this state. |
| user_id | → users not null | |
| timestamp | timestamptz not null, indexed | |
| method | text not null | `scanned` / `manual`. Closed set → enum. |
| reason | text | Required when `method = 'manual'`. |
| gps_lat / gps_lng | double precision | |
| within_radius | boolean | |
| generated_checklist_id | → checklist_instances unique | A checkpoint scan may spawn a checklist. |

## Checklists

Templates are authored per role and instantiated as **fully materialized
copies**: every section and item of an instance exists as a row from the moment
it is assigned, so display logic only ever renders rows. Trigger rules decide
*if* a row is created; `hide_until` decides *when* it becomes visible — and
once visible, nothing ever re-hides.

#### `checklist_templates` — Tier 0 / `manage_checklists` · sync: always

| Column | Type | Notes |
|---|---|---|
| name | text not null | |
| trigger_type | text not null, indexed | `manual` / `clock_in` / `clock_out` / `checkpoint` / `recurring`. |
| trigger_config | jsonb | Recurring: `{recurrenceRule: RRULE}`. Genuinely shape-varying; stays `jsonb`. |
| assigned_role_id | → roles not null | Every template belongs to exactly one role; its members work the instances. |
| assigned_to_user | boolean not null default false | True: assigned to whoever triggered it. False: unclaimed, for any holder of the role. |
| hide_until_rule | text | `"HH:MM"`, resolved to `instance.hide_until` at creation. |
| expected_start | text | `"HH:MM"`, nullable — when this checklist is normally started. It is what gives every `hide_until_rule` in the template (its own and its sections') a **date**: at creation it resolves to `instance.expected_start_at`, the occurrence nearest the creation time (±12h, a tie going to the past), and each hide-until becomes the first occurrence of its clock time at or after that anchor — which may be in the past, meaning "already visible". Without it a hide-until rolls forward from the creation time, which hides a section for a whole shift whenever the checklist is started after the reveal time, and after midnight resolves to the wrong calendar date entirely. Lives on the template, not the shift or the marina's settings, so nothing about who clocked in when can move it. |
| due_by | jsonb | `{kind:"time",time}` or `{kind:"offset",minutes}`, resolved at creation. |
| creator_id | → users | |

`template_viewer_roles` — junction: read-only cross-role monitoring, e.g.
office watching maintenance's progress without holding the role.

#### `checklist_template_sections` — Tier 0 / `manage_checklists` · sync: always

`template_id`, `name`, `position integer not null`, `is_active boolean not null`
(inactive sections are never instantiated), `trigger_type`, `trigger_config jsonb`,
`hide_until_rule`, `due_by jsonb`, `location_id → locations`.

Junctions: `template_section_checkpoints`, `template_section_assets`.

Manual and recurring sections are created with the instance; checkpoint,
location and asset sections are created lazily when that thing is actually
visited, onto an already-open instance.

#### `checklist_template_items` — Tier 0 / `manage_checklists` · sync: always

`section_id` (**nullable** — see below), `type` (`simple_check` /
`verify_task` / `door_check` / `lock_check` / `location_check` /
`meter_reading` / `question`), `label`, `config jsonb`, `position`,
`version integer not null default 1`,
`previous_version_id → checklist_template_items`.

**Copy-on-edit.** Committing an edit writes a *new* row and repoints the
section, so instance items forever reference the exact row they were created
from without snapshotting config per instance. There is no forward "current"
pointer: the live version is whichever row the section points at.

> **`section_id` is nullable, deliberately.** A superseded version is orphaned
> from its section but keeps its instance references. 5 of 79 exported items
> are in this state, with 5 instance items pointing at them. `NOT NULL` would
> force dropping them and silently blank out months-old completed checklists.

> **Unwound.** The type list above is corrected against real data.
> `instant.schema.ts`'s conventions comment still names `gas_pump_check`,
> which was renamed to `lock_check` long ago, and omits `question` entirely.
> `ITEM_TYPE_LABEL` in `src/lib/checklists.ts` is the authority.

#### `checklist_instances` — Tier 0 · sync: **age**

`template_id`, `assigned_to_id → users`, `status` (`not_started` /
`in_progress` / `complete`), `started_at`, `completed_at`, `hide_until`, `expected_start_at` (the template's `expected_start` resolved once, at creation — stored because sections are added to a live checklist hours later, by which time "the nearest 5 PM" is a different evening)
(absent or past = visible), `due_by`, `parent_item_id → checklist_instance_items`
(set only on nested instances spawned by a `location_check` item — the
checklist list shows instances where this is null, so sub-checklists don't
double-list).

#### `checklist_instance_sections` — Tier 0 · sync: **age**

`instance_id`, `template_section_id`, `label` (copied at creation),
`position`, `hide_until`, `due_by`, `location_id`. Junctions to checkpoints and assets.

#### `checklist_instance_items` — Tier 0 · sync: **age**

`section_id`, `template_item_id → checklist_template_items not null` (pins the
exact version; label, type and config are always read *through* here, never
copied), `position`, `completed_at`, `completed_by_id → users`,
`result jsonb` (shape varies by item type), `note`,
`linked_ticket_id → tickets unique`.

## Incidents, tickets & notes

#### `notes` — Tier 0 · sync: **age**

`body text not null`, `created_at`, `author_id → users`, plus the six-column
attachment target and its constraint.

#### `incident_types` — lookup · Tier 0 / `manage_marina_settings` · sync: always

`name`. Admin-expandable.

#### `incident_statuses` — lookup · Tier 0 / `manage_marina_settings` · sync: always

`name`, `is_terminal boolean`, `position`.

> **Unwound.** Was `status text` plus a parallel `custom_status text` column
> for admin-defined values — a shadow field compensating for a type that
> couldn't express the product. One table replaces both.

#### `incidents` — **Tier 1: `view_incidents` / `create_incidents`** · sync: **age**

`title not null`, `incident_type_id`, `status_id → incident_statuses`,
`details text` (markdown), `created_at`, `author_id`, `assigned_to_id`, plus
the attachment target.

#### `incident_comments` — **Tier 1: `view_incidents` / `create_incidents`** · sync: **age**

`incident_id`, `body` (markdown), `created_at`, `author_id`.

#### `ticket_statuses` — lookup · Tier 0 / `manage_marina_settings` · sync: always

`name`, `is_terminal`, `position`. Labels are admin-adjustable.

#### `tickets` — Tier 0 · sync: **age**

| Column | Type | Notes |
|---|---|---|
| title | text not null | |
| description | text | markdown |
| priority | enum not null, indexed | `low` / `medium` / `high` / `urgent`. Genuinely closed → Postgres enum. |
| status_id | → ticket_statuses not null | |
| auto_generated | boolean not null | |
| created_at / resolved_at | timestamptz | |
| created_by_id / assigned_to_id | → users | |
| source_incident_id | → incidents | |
| source_finding_id | → audit_findings, `on delete set null` | Raised from an Audit. |
| proposal_id | → audit_proposals, `on delete set null` | Raised against a proposed new Location. The target is the proposed parent until approval re-targets it. |
| *attachment target* | | Six columns + constraint. |

Ticket creation is deliberately ungated — every role may raise one. There is
no `create_ticket` permission.

## Assets

#### `assets` — Tier 0 / `manage_assets` · sync: always

| Column | Type | Notes |
|---|---|---|
| name | text not null | |
| category | text | |
| location_id | → locations | Not exclusive occupancy — a location holds many assets. |
| has_meter | boolean not null | |
| meter_type | text | `mileage` / `hours`. |
| meter_reading | numeric | Latest value, written with the reading. |
| checkoutable | boolean not null | |
| reservation_enabled | boolean not null | |
| reservation_visibility | text | |
| post_return_status_id | → asset_statuses | |

> **Unwound.** `current_status` is **deleted**. It denormalized the newest
> `asset_status_logs` row; that table is always-resident and tiny, so the
> device derives it with `order by timestamp desc limit 1`. No trigger, no
> client-side dual write, no window in which an asset lies about itself.

#### `maintenance_rules` — Tier 0 / `manage_assets` · sync: always

`asset_id`, `kind` (`meter` / `time`), `every numeric not null`, `label`.

> **Unwound.** Was a `jsonb` array on the asset. `maintenanceRules.ts` queries
> these to decide when a ticket fires, which wants `where kind = 'time'`
> rather than unpacking a blob per asset.

#### `asset_statuses` — lookup · sync: always

`name`, `position`.

#### `asset_status_logs` — Tier 0 · sync: **always**

`asset_id`, `status_id`, `note`, `timestamp`, `logged_by_id`. Always-resident
despite being a log, because it is small and `assets.current_status` was
removed in favour of deriving from it.

#### `asset_checkouts` — Tier 0 / `manage_assets` · sync: **age**

`asset_id`, `person_id → contacts`, `checked_out_by_id → users`, `time_out`,
`time_in` (null while out).

#### `asset_meter_readings` — Tier 0 · sync: **age**

`asset_id`, `value numeric not null`, `source` (`manual` / `checklist_item`),
`timestamp`, `correction_reason` (required when below the previous reading),
`logged_by_id`.

## Reservations

#### `reservations` — Tier 0 / `manage_reservations` · sync: **occupancy**

| Column | Type | Notes |
|---|---|---|
| status | text not null, indexed | `requested` / `confirmed` / `checked_in` / `checked_out` / `cancelled`. Closed → enum. |
| contact_id | → contacts not null | |
| location_id / asset_id | → locations / assets | Exactly one, by check constraint. |
| billing_type | text | `billable` / `non_billable`; defaults from the target's visibility. |
| expected_checkin / expected_checkout | timestamptz, indexed | **These define the occupancy sync window.** |
| actual_checkin / actual_checkout | timestamptz | |
| early_checkin / late_checkout | timestamptz | Ignored when non-billable. |
| rate / deposit / balance | numeric | |

## Services, amenities & attributes

Marina-defined catalogues of what a Location provides, and what it will
accept. See [`audits.md`](audits.md) § *Services, Amenities and Attributes*
and [ADR 0007](adr/0007-meters-on-services-not-assets.md).

#### `services` — Tier 0 / `manage_locations` · sync: always

`name text not null unique`, `unit text` (kWh, gallons; used when a
location's instance is metered), `position integer`.
`service_location_types` — junction: `service_id`, `location_type_id`. The
types a service is valid for.

#### `amenities` — Tier 0 / `manage_locations` · sync: always

`name text not null unique`, `position integer`.
`amenity_location_types` — junction, as above.

#### `location_services` — Tier 0 · sync: always

| Column | Type | Notes |
|---|---|---|
| location_id | → locations not null | |
| service_id | → services not null | `unique (location_id, service_id)`. Row present = service present. |
| working | boolean not null default true | Applied immediately by an audit Finding. |
| metered | boolean not null default false | |
| note | text | Free text; the UI suggests existing notes for this service ordered by use count — a query, not a table. |

Presence (row insert or delete) changes through an approved audit Proposal
or the admin location editor; never directly from a Finding.

#### `location_amenities` — Tier 0 · sync: always

`location_id`, `amenity_id` (`unique` pair), `note text`. Same rules as
`location_services`. Recorded on the Location that offers the amenity; a
parent's amenities are not copied to children.

#### `attributes` — Tier 0 / `manage_locations` · sync: always

`name text not null unique`, `kind attribute_kind not null` (`number` /
`choice`), `unit text` (ft; a `number`'s, shown beside the value),
`choices text[]` (a `choice`'s options; a `STRUCTURED_COLUMNS` entry),
`position integer`. `attribute_location_types` — junction, as `services`.

#### `location_attributes` — Tier 0 / `manage_locations` · sync: always

| Column | Type | Notes |
|---|---|---|
| location_id | → locations not null | |
| attribute_id | → attributes not null | `unique (location_id, attribute_id)`. An Attribute is never present or absent on a Location of a valid type — it always applies — so row presence here means only "a value has been entered." No value entered = no row, not a separate flag. |
| value | numeric | A `number` Attribute's value, in its `unit`. |
| value_text | text | A `choice` Attribute's value, one of its options. |
| note | text | |

`check (num_nonnulls(value, value_text) = 1)` — a row holds a number or a
choice, never both and never neither; no row at all means no value set.

Unlike `location_services` / `location_amenities`, no Tier 0 write policy:
once an Audit exists for the Location, every value change — including
clearing one — is a `set_attribute` Proposal, applied only by the
security-definer `finalize_audit()`. A direct edit (the admin location
editor) still needs only `manage_locations`, the same as the catalogue.

#### `service_meter_readings` — Tier 0 · sync: **age**

| Column | Type | Notes |
|---|---|---|
| location_service_id | → location_services not null, indexed | |
| value | numeric not null | In the service's `unit`. |
| read_at | timestamptz not null default now() | |
| read_by_id | → users | |
| reset | boolean not null default false | The meter was replaced or zeroed; consumption is never computed across a reset row. |
| source_finding_id | → audit_findings, set null | |

History only; no rule fires from these. The billed party is derived later
from the Lease or Reservation active at `read_at`.

## Boats, owners & leases

#### `contacts` — **Tier 1: `view_owner` / `edit_owner_contact`** · sync: **occupancy**

`name text` (nullable until the nameless-contact prompt fills it),
`merged_into_id → contacts` (the merge trail).

Identity only. This is the row that says *who* someone is.

#### `contact_details` — **Tier 1: `view_contact` / `edit_owner_contact`** · sync: **occupancy**

`contact_id → contacts primary key`, `phone text indexed`, `email text`, `address text`.

> **Unwound.** One table became two because `view_owner` and `view_contact`
> govern the same row's *different columns*, which RLS cannot express. A
> device holding a user with `view_owner` but not `view_contact` never
> receives these rows at all — which is what makes the boundary hold offline
> and not merely in a query. See [Permissions](permissions.md).

#### `boats` — Tier 0 · sync: **occupancy**

`name not null`, `description`, `length numeric`, `make`, `model`,
`registration_number`, `location_id → locations` (nullable, indexed — the
boat's current slip; a boat is in at most one place, a place holds many).

`boat_owners` — junction: `boat_id`, `contact_id`, `position integer not null`
(order of succession). `boat_authorized_users` — junction, unordered.

> **Unwound.** Succession order was an `owner_order` JSON array of contact ids
> beside an unordered link set. Same fix as tour checkpoints.

#### `vehicles` — Tier 0 · sync: **occupancy**

`description text not null` (the primary label — staff know a vehicle by
sight), `plate_number indexed`, `location_id → locations` (nullable,
indexed). `vehicle_owners` junction with `position`.

#### `leases` — **Tier 1: `view_lease` / `manage_lease`** · sync: **occupancy**

`location_id → locations`, `start_date`, `end_date` (**these define the
occupancy sync window**), `variances_and_conditions text`.
`lease_lessees` — junction to contacts. `lease_documents` — junction to attachments.

#### `lease_comments` — **Tier 1: `view_lease` / `manage_lease`** · sync: **occupancy**

`lease_id`, `body`, `created_at`, `author_id`.

## Audits

Field review of Locations against reality. Behaviour in
[`audits.md`](audits.md); vocabulary in `CONTEXT.md`.

#### `audit_templates` — Tier 0 / `manage_audits` · sync: always

`name text not null`, `kind audit_kind not null` (`occupancy` / `status`),
`created_by_id → users`, and five `include_* boolean not null default true`
columns (`attributes`, `services`, `amenities`, `marked`, `map`) — which
built-in Status-kind categories the Template asks about (`audits.md` §
Audit Templates). Meaningless for kind `occupancy`, whose built-ins aren't
split into categories. Copied onto the Audit at launch, like the rule tree.

#### `audit_rules` — Tier 0 / `manage_audits` · sync: always

| Column | Type | Notes |
|---|---|---|
| template_id | → audit_templates, cascade | Exactly one of `template_id` / `audit_id` by check constraint. Launch copies a template's rule tree onto the audit so later template edits never reach it. |
| audit_id | → audits, cascade | |
| parent_rule_id | → audit_rules, cascade | Tree. A child narrows its parent. |
| position | integer not null | Order among siblings. |
| mode | text not null | `all` (every condition must hold) or `any`. |
| conditions | jsonb not null | `[{subject, verb, value}]` — the sentence grammar in `audits.md` § Rules, evaluated by `src/lib/auditRules.ts` on the client at launch. Negation is a verb. A `STRUCTURED_COLUMNS` entry. |

#### `audit_questions` — Tier 0 / `manage_audits` · sync: always

| Column | Type | Notes |
|---|---|---|
| rule_id | → audit_rules not null, cascade | Asked only of Locations this rule selects. |
| position | integer not null | |
| prompt | text not null | |
| kind | audit_question_kind not null | `yes_no` / `choice` / `text` / `meter_reading`. Door and lock checks deliberately absent. |
| choices | text[] | `choice` only. |
| ticket_on_no | boolean not null default false | `yes_no` only. |
| service_id | → services | `meter_reading` only: which metered service to read. |

#### `audits` — Tier 0 · sync: **current** (see below)

| Column | Type | Notes |
|---|---|---|
| name | text not null | |
| kind | audit_kind not null | Copied from the template at launch. |
| template_id | → audit_templates, set null | Provenance only. |
| status | audit_status not null, indexed | `open` / `closed` / `finalized`. No reopening. |
| launched_by_id / launched_at | | |
| closed_by_id / closed_at | | Null `closed_by_id` on an automatic close. |
| finalized_by_id / finalized_at | | |
| is_current | boolean not null default true | Sync scope: true while not finalized, and for 30 days after; maintained by `refresh_sync_scopes_all()`. Every child table below inherits the scope through its audit. |
| include_attributes / include_services / include_amenities / include_marked / include_map | boolean not null default true | Copied from the Template at launch (or set directly at launch for a blank one). Which built-in Status-kind categories this Audit asks about. |

`audit_assignees` — `audit_id`, `user_id` / `role_id` (exactly one).

#### `audit_shares` — Tier 1 `manage_audits` (read and write) · sync: **none**

| Column | Type | Notes |
|---|---|---|
| audit_id | → audits not null, cascade | The Audit must be `closed` or `finalized`; a trigger refuses an `open` one. |
| key | uuid not null unique default gen_random_uuid() | The credential in `/r/<key>`. Never shown in a list once created except through *Copy link*. |
| label | text | Who it went to. |
| created_by_id / created_at | | |
| expires_at | timestamptz | Default `now() + 90 days`; null means never. |
| revoked_at | timestamptz | Set once, never cleared. |
| view_count | integer not null default 0 | Bumped by `audit_report()`. |
| last_viewed_at | timestamptz | Likewise. |

Never synced: the audit page reads it online through PostgREST under RLS,
and the public reads it only through `audit_report(key)`. A share key in a
guard's local database would be a credential lying around, so Tier 0 users
cannot read this table at all.

#### `audit_report_snapshots` — no policies · sync: **none**

`audit_id` (primary key → audits, cascade), `document jsonb not null`,
`created_at`. The Audit Report as `finalize_audit()` compiled it, served
verbatim to every view afterwards (`docs/audits.md` § Sharing the
results). Only the report functions touch it. An audit finalized before
the table existed gets its snapshot on first read.

#### `audit_targets` — Tier 0 · sync: through audit

| Column | Type | Notes |
|---|---|---|
| audit_id | → audits not null, cascade | |
| location_id | → locations, **set null** | `unique (audit_id, location_id)`. Fixed at launch. Null once a no-history location is deleted at finalize; the target and its finding remain as the record. |
| location_name | text not null | Snapshot at launch, for the same reason. |
| position | integer not null | Tree order at launch. |
| state | audit_target_state not null | `pending` / `audited` / `not_audited`. |
| not_audited_reason | text | `closed early`, `retired by Audit <name>`. |
| displaced_note | text | "expected <boat>, found elsewhere", written by another Finding in the same audit that moved this target's occupant. On the target, not a Finding, so writing it never marks the target audited. |

`audit_target_questions` — `target_id`, `question_id`, `position`: which questions the target is asked, fixed at launch like the list itself.

#### `audit_findings` — Tier 0 · sync: through audit

One per target; a Finding with no target is a proposed new Location.

| Column | Type | Notes |
|---|---|---|
| audit_id | → audits not null | |
| target_id | → audit_targets unique | Null only for a proposed new Location, whose details live in its `create_location` Proposal. |
| recorded_by_id | → users not null | Only this user may edit, and only while the audit is open. |
| recorded_at / updated_at | timestamptz | |
| occupied | boolean | Occupancy kind. |
| contact_id | → contacts | Optional occupant. |
| unexpected_occupancy | boolean not null default false | Derived at save: `occupied` disagrees with the presence of a current Lease or `checked_in` Reservation. |
| clearly_marked / mapped_correctly | boolean | Status kind. |

Junctions: `audit_finding_boats`, `audit_finding_vehicles` (occupants
recorded). `audit_finding_services` (`finding_id`, `service_id`, `present`,
`working`, `note`) and `audit_finding_amenities` (`present`, `note`) record
what was observed; `working` and `note` apply at once, `present` becomes a
Proposal when it differs from the Location's row. `audit_finding_answers`:
`finding_id`, `question_id`, `value jsonb` (a `STRUCTURED_COLUMNS` entry),
`ticket_id → tickets`.

#### `audit_proposals` — Tier 0 · sync: through audit

| Column | Type | Notes |
|---|---|---|
| finding_id | → audit_findings not null, cascade | |
| kind | audit_proposal_kind not null | `create_location` / `retire_location` / `rename` / `retype` / `reparent` / `move_placement` / `set_gps` / `set_service` / `set_amenity` / `set_attribute`. |
| structural | boolean not null | True for the first six; deciding those needs `manage_locations`. Stored rather than derived so RLS can test it. |
| payload | jsonb not null | Kind-specific. `create_location`: name, type, parent, gps, services, amenities, status, occupants. `set_gps`: lat, lng, accuracy. `set_service`: service_id, present. `set_attribute`: attribute_id, value, text, note — a number fills `value`, a choice fills `text`, both null clears it; never a separate presence flag. A `STRUCTURED_COLUMNS` entry. |
| decision | audit_decision | Null until decided; `approved` / `rejected`. |
| decided_by_id / decided_at / reason | | Reason required on reject. |
| applied_location_id | → locations | For `create_location`, the row created on approval; tickets carrying this proposal re-target to it. |

Decisions save one at a time. The audit can finalize only when no
proposal's `decision` is null; finalize applies approved proposals in
`docs/audits.md` § *Finalizing* order.

## Shifts & activity log

#### `shifts` — Tier 0 · sync: **age**

`guard_id → users not null`, `started_at`, `ended_at`, `report_sent_at`
(written by the Twilio Function that sends it),
`end_of_shift_checklist_id → checklist_instances unique`.

#### `activity_log_entries` — Tier 0 read · sync: **age**

| Column | Type | Notes |
|---|---|---|
| event_type | text not null, indexed | e.g. `ticket.created`. |
| summary | text not null | |
| timestamp | timestamptz not null, indexed | |
| protected | boolean not null default false | Exempts the entry from retention purge, for legal or evidentiary reasons. |
| subject_type / subject_id | text / uuid indexed | The record the event happened to. Deliberately *not* a foreign key — the log outlives what it describes. |
| actor_id | → users | |

**Insert always; update only `protected`; delete never.** The scheduled
`pg_cron` purge is the only thing that removes entries — see
[Architecture — Where work runs](architecture.md).

The largest table by a wide margin: an estimated 100k–250k rows/year. This is
what makes retention mandatory rather than optional, and why it is age-scoped
and never fully resident.

## Communications

Every row here is written by a Twilio Function, which is the only legitimate
writer of Twilio-sourced values, using a **dedicated Postgres role scoped to
these tables** rather than the service-role key.

#### `calls` — **Tier 1: `view_calls` / `place_calls`** · sync: **age**

`direction` (`inbound` / `outbound`, enum), `line`, `from_number`, `to_number`,
`started_at`, `duration integer`, `recording_url`, `transcript`,
`missed boolean not null indexed`, `voicemail_url`, `contact_id → contacts`.

#### `call_notes` — **Tier 1: `view_calls`** · sync: **age**

`call_id`, `body`, `created_at`, `author_id`.

#### `sms_threads` — **Tier 1: `view_sms` / `place_calls`** · sync: **age**

`line`, `contact_id`, `last_message_at indexed`, `unread boolean not null indexed`.

`last_message_at` is written by the Twilio Function alongside the message, not
by a trigger and not by the client. `unread` is not denormalization — nobody
derives it, someone marked it.

#### `sms_messages` — **Tier 1: `view_sms`** · sync: **age**

`thread_id`, `direction`, `body`, `timestamp`, `sent_by_id → users`.

#### `sms_templates` — Tier 0 · sync: always

`label`, `body`, `scope` (`global` / `personal`), `owner_id → users`.

#### `chat_rooms` / `chat_messages` — Tier 0 · sync: **age**

`chat_rooms`: `title`, `topic`, `created_at`, `created_by_id`.
Junctions `chat_room_users` and `chat_room_roles` for invitations.
`chat_messages`: `room_id`, `author_id`, `body`, `timestamp`, plus a junction
to attachments.

## Attachments

#### `attachments` — Tier 0 · sync: metadata **always**, bytes on demand

| Column | Type | Notes |
|---|---|---|
| storage_path | text unique not null | Path in Supabase Storage. |
| content_type / byte_size | text / bigint | |
| uploaded_by_id | → users | |
| created_at | timestamptz | |
| upload_state | text not null | `pending` / `uploaded`. A row created offline is `pending` until its bytes drain. |

> **Unwound.** Replaces `$files`. PowerSync replicates rows, not blobs, so the
> row and the bytes travel separately: the row syncs normally and the file goes
> through a local upload queue. A `pending` row renders as such rather than as
> broken — the attachment's *existence* is never lost even when its bytes are
> still on the device. See [Architecture — Attachments](architecture.md).

## Marina configuration

#### `marina_settings` — Tier 0 / `manage_marina_settings` · sync: always

Single row, enforced by `check (id = 1)`.

| Column | Type | Notes |
|---|---|---|
| marina_name | text | |
| gps_validation_radius_default | integer not null | Metres; checkpoints may override. |
| audit_gps_radius | integer not null default 15 | Metres. An audit prompts to re-capture a Location's coordinates when the device is farther than this from them. Distinct from the checkpoint radius, which is tuned for "did the guard get near enough". |
| audit_gps_accuracy | integer not null default 10 | Metres. A GPS capture is refused when the device's reported accuracy is worse than this. |
| activity_log_retention_days | integer not null | Drives the `pg_cron` purge. |
| call_recording_enabled / call_transcription_enabled | boolean not null | |
| shift_report_recipients | text[] | |
| allow_overlapping_reservations | boolean not null | |
| haul_out_mode | text | `ask` / `customer` — whether hauling a boat out prompts for who did it. A marina haul-out raises a Ticket; a customer one doesn't. |

#### `phone_lines` — Tier 0 / `manage_marina_settings` · sync: always

`number text not null`, `label text not null`, `routing jsonb`.

> **Unwound.** Was a `jsonb` array on marina settings. The Twilio Function
> routes calls by looking a number up here; parsing a blob to do it was
> incidental complexity.

## What the migration removes

Eight structures existed only to work around InstantDB and do not survive:

| Gone | Replaced by |
|---|---|
| `$users` namespace and the `userAuth` link | `users.clerk_user_id` |
| `users.can_manage_roles` / `can_manage_users` | `effective_permissions` view |
| `tours.checkpoint_order` JSON array | `tour_checkpoints.position` |
| `boats.owner_order` / `vehicles.owner_order` | junction `position` columns |
| `incidents.custom_status` | `incident_statuses` lookup |
| `assets.maintenance_rules` jsonb | `maintenance_rules` table |
| `marina_settings.phone_lines` jsonb | `phone_lines` table |
| `assets.current_status` | derived from `asset_status_logs` |

And one invariant moves from application code into the database: exactly one
attachment target, as a `CHECK` constraint.
