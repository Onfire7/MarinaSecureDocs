# Location Audits

Behavioural spec for the audit system. Vocabulary is in `CONTEXT.md`
(Audit, Audit Template, Audit Rule, Audit Question, Finding, Proposal,
Service, Amenity, Retired Location, Unexpected Occupancy). Tables are in
`docs/data-model.md` § *Audits* and § *Services & amenities*. Decisions that
reshaped older parts of the model are ADR 0006 (occupancy on the occupant)
and ADR 0007 (meters on services).

Settled with the owner over 2026-09-21/22. Every statement here is a
requirement; where a page spec (`src/pages/audits/*.spec.md`) exists it
refines this, never contradicts it.

## Purpose

An Audit reconciles what the system records about a set of Locations with
what is physically there, and is worked by whoever is already walking the
property. Two kinds:

- **Occupancy** — who and what is at each Location. Serves the office's
  occupancy picture and catches occupants nobody is billing.
- **Status** — the Locations themselves: which Services and Amenities are
  present and working, whether the place is marked and mapped correctly,
  and whether the marina delivers what it advertises there.

A **Vacancy Audit** is an Occupancy Audit whose rules select vacant
Locations. It is not a third kind.

Audits are also how the marina's Locations acquire GPS coordinates. None
have them today.

## Permissions

| Action | Needs |
|---|---|
| Create or edit an Audit Template | `manage_audits` |
| Launch, close an Audit | `manage_audits` |
| Record a Finding | assignment (a User or one of their Roles is an assignee). Row-level: any active marina user may insert; assignment is enforced in the UI and the data layer, matching how ticket creation is ungated. |
| Approve or reject a Proposal about Service or Amenity presence, or GPS | `manage_audits` |
| Approve or reject a structural Proposal (new, retired, renamed, retyped, reparented, re-placed Location) | `manage_locations` |
| Finalize | `manage_audits`; **and** `manage_locations` when any structural Proposal exists |
| Maintain the Services and Amenities catalogue | `manage_locations` |

No role is hardcoded anywhere. "Manager" is not a term; it means "a User
with the permission the row requires".

## Services and Amenities

Two marina-defined catalogues, edited under Admin beside Location Types.

- A **Service** is a fixed utility: 30A power, 50A power, water, sewer. It
  declares an optional **unit** (kWh, gallons) used when metered.
- An **Amenity** is an extra: WiFi, fire pit, grill, picnic table.

Each catalogue entry names the Location Types it is **valid for**. A
Location records, for each valid entry:

- Service: present (row exists), **working** (boolean), **metered**
  (boolean), note.
- Amenity: present (row exists), note.

Amenities of a parent (a pavilion, a bathhouse) are recorded on the parent
only; they are understood to serve its children and are not copied down.

**Notes** are entered through a typeable selection. The suggestions are the
distinct notes already recorded for that same Service or Amenity across all
Locations, ordered by how many Locations use each, so common values ("metered",
"shared pedestal") are one tap and one-offs are still typeable. Nothing is
stored for the suggestion list; it is a query.

**Metered Services** hold meter readings: value, read-at, read-by, and a
`reset` flag that marks a replaced or zeroed meter so consumption is never
computed across it. Readings are history only. Who the usage is billed to is
derived later from the Lease or Reservation active at the reading time (ADR
0007).

## Audit Templates

An Audit Template is reusable and has:

- a **name**
- a **kind**: `occupancy` or `status`, chosen once, never varying per rule
- a tree of **Audit Rules**
- **Audit Questions**, each attached to one rule

Templates are edited under Admin beside Checklist Templates.

### Rules

A rule selects Locations with one or more **conditions**, joined by *all
of* (and) or *any of* (or). A condition is a sentence, **subject · verb ·
value**, and negation is a verb, never a separate toggle:

| Subject | Verbs | Value |
|---|---|---|
| Name | contains / starts with / ends with / is / does not contain / does not end with | text |
| Type | is / is not | a Location Type |
| Location | is under / is not under | a Location with children (any depth) |
| Status | is / is not / counts as vacant / does not count as vacant | a Location Status; none for the vacancy verbs, which read `is_vacancy` |
| Service | includes / does not include | a Service |
| Amenity | includes / does not include | an Amenity |
| Lease | is current / is absent | none. A Lease whose window contains now |
| Reservation | is active / is absent | none. A Reservation in `checked_in` |
| Last audited | before | a date. No Finding in any finalized Audit of the same kind since it |

A condition whose verb needs a value, and has none yet, is **inert**: it
does not narrow anything and does not appear in the rule's description.
Adding a condition never changes a count until it is filled in.

A **child rule narrows its parent**: it selects only from what the parent
selected. Sibling rules are independent branches. A Location selected by a
parent and by no child is still a target and gets the built-in questions
only. A Location selected by two sibling rules is one target and is asked
both rules' questions, once each.

The example the design was checked against: a root rule *under B Dock*; two
children, *name ends with L* asking "Does the left-side pedestal have
power?" and *name ends with R* asking "Is water present?". Every B Dock slip
is a target; L slips get one extra question, R slips the other.

Rules are resolved into a fixed target list **at launch** (see below).

### The template editor

Settled by prototype on 2026-09-22 (branch `prototype/audit-rules`; three
variants driven against real locations at 390 px and 1280 px).

- **Two layouts by width**, one model. Above the mobile breakpoint the whole
  tree is an **outline**: nested cards, each showing its conditions, its
  questions, "narrows to 26 of 52", and a *narrow further* button, with the
  live preview as a sticky right column. Below it, **one rule per screen**:
  a breadcrumb of chips ("All · 547 › Location is under BH14 · 52 › Name
  ends with l · 26") is the narrowing story, child rules are rows showing
  "26 of 52" that open on tap, and the preview sits inline beneath. Past
  three levels the breadcrumb collapses its middle to "…".
- **Every rule has a colour**, assigned in tree order so siblings differ,
  shown as a dot beside its description on its card, chip and row, and as a
  coloured left edge. **Preview rows carry one dot per rule that selected
  them**, at every width; a row with two dots is a Location two sibling
  rules both ask about. Root rules add no dot unless there are several, since
  one root would mark every row. Labelled pills were tried and rejected on
  both widths: too wide for a phone, too busy for the desktop column.
- **Hover, desktop only, in both directions.** Hovering a rule card dims the
  preview rows it did not select, with a caption naming the rule. Hovering a
  dot in the preview rings that rule's card in its colour and dims every
  other branch; the card's ancestors stay lit because the card sits inside
  them. Phones have no hover and get neither; the dots and the rule list as
  legend carry the meaning.
- **Counts always read "n of parent"**, never a bare n. That is what made
  "a child narrows its parent" legible without explanation in every variant.
- The **Location** value picker is a search picker, not a native select; a
  marina has hundreds of containers.
- A **Miller-columns** variant was the nicest desktop browser and had no
  phone answer; rejected.

### Questions

Attached to a rule, ordered, with a prompt and one of four kinds:

- **Yes/No**, with an optional *raise a Ticket when No* that opens the
  ticket form pre-filled with the prompt and the Location.
- **Choice**: a fixed list, single select.
- **Text**.
- **Meter Reading**: names a Service; answering records a reading against
  that Service at the Location (creating the `location_services` row as
  metered if the Location has the Service but not marked metered is **not**
  done — the question is skipped with "not metered here" when the Location
  has no metered instance of that Service).

Door Checks and Lock Checks are deliberately not available; they belong to
checklists.

### Built-in questions

Fixed per kind. A template cannot switch them off.

**Occupancy**

1. *Occupied?* Yes/No.
2. If yes: occupants — zero or more Boats (types with `has_boat`), zero or
   more Vehicles (`has_vehicle`), and optionally one Contact. Each is
   search-as-you-type over existing records with create-on-no-match.
3. *Unexpected Occupancy* is **derived**, not asked: occupied with no
   current Lease and no active Reservation, or vacant with one. The auditor
   sees it as a badge on the Finding; it is not editable.

**Status**

1. For each Service valid for the type: present? working? note.
2. For each Amenity valid for the type: present? note.
3. *Is this Location clearly marked?* Yes/No.
4. *Is this Location placed correctly on the map?* The map it is plotted on
   is shown with its rectangle highlighted (its nearest ancestor's map when
   it is plotted nowhere); tapping a new spot is a `move_placement` Proposal
   and answers No.

**Both kinds**: the **GPS prompt**, shown only when the Location has no
coordinates, or the device is farther from them than the marina's *audit
GPS radius* setting. See *GPS capture*.

Every Finding also offers *raise a Ticket*, *log an Incident* (subject to
`create_incidents`), and *record a Note* against the Location.

## Launching

From the Audits section, a User with `manage_audits`:

1. Picks a Template, or starts from a blank one.
2. Sees the template's rules and questions **on the launch screen** and may
   edit them. Edits are copied onto the Audit; the Template is unchanged
   unless the User taps *save back to template*.
3. Names the Audit (defaults to the template name and date).
4. Assigns it to any mix of Users and Roles.
5. Launches. The rules resolve **now** into the fixed **target list**, one
   row per Location, ordered by tree position (parent before children,
   siblings by their existing sort). Retired Locations and Locations whose
   type does not track status are never targets, except that a Status Audit
   may target non-status-tracking types when a rule names them explicitly by
   type.

A Location added to the marina after launch is not in the Audit. A
Location the auditor finds that isn't in the marina is a Proposal, not a
target.

The Audit is now **Open**.

## Field work

### Where an Audit appears

An Open Audit appears to its assignees in three places, all showing the
same Finding form:

1. **On a checkpoint scan.** When the scanned checkpoint's Location has
   any of the User's Open Audit targets at or under it, an **Audits section
   is rendered above every checklist section** on the resulting screen so it
   cannot be missed. It lists the un-audited targets under that Location.
2. **On the active checklist view**, the same section, listing all of the
   User's Open Audit targets, sorted as below.
3. **In the Audits section** of the app, for a User doing an audit without
   a checklist running.

The section **never blocks checklist completion**. It reports progress
("12 of 40 audited"); a checklist completes regardless.

When more than five targets remain, the section is collapsed to its
progress header and expands on tap. When a Finding is saved, the section
scrolls so the top of the next target is at the top of the screen.

Only the User's assigned Audits are shown. A User with `manage_audits` sees
every Open Audit.

### Ordering

Targets are ordered by distance from the device when both the device and
the target have coordinates; targets without coordinates follow, in tree
order. Until Locations have coordinates this is tree order in practice.
Marina Zones (`docs/TODO.md`) will refine this later.

### Selecting a Location

The auditor may also pick a target by search-as-you-type over the target
list and, failing that, over all Locations. Typing never creates; when
nothing matches, the form offers *propose a new Location here*.

### One Finding per target

A target has at most one Finding. The first assignee to save one wins and
the target leaves everyone else's list. The author may edit their Finding
until the Audit closes; nobody else may. A colleague who disagrees records
a Note on the Location. Every version is in the Activity Log.

### What applies immediately

Saving a Finding applies these at once, each with an Activity Log entry
naming the Audit:

- Location Status.
- Occupants. A Boat or Vehicle recorded here is moved to this Location. If
  it was recorded elsewhere, that Location's occupant list loses it; when
  that Location is a target of the **same** Audit, its Finding (or a
  placeholder if none yet) gets the flag *expected &lt;boat&gt;, found
  elsewhere* for the next auditor to confirm.
- A Boat, Vehicle or Contact created during the Finding. These are real
  records at once, and their creation entry in the Activity Log says
  *added during Audit &lt;name&gt;*. Contact creation needs a name only.
  "Occupied by someone who refused ID" is recorded as occupied with no
  Contact; no placeholder Contact is ever created.
- Service *working* flags and Amenity notes on entries already present.
- Audit Question answers, the Tickets they raise, Incidents, Notes.
- Meter readings.

### What becomes a Proposal

These are recorded in the Finding and **do not change the marina until a
decision at finalize**:

| Proposal | Why held |
|---|---|
| New Location (name, type, parent, GPS, Services, Amenities, status, occupants) | structural |
| Retire this Location | structural |
| Rename, change type, change parent | structural |
| Move on the map | structural; every User navigates by it |
| GPS coordinates | a wrong pin misleads everyone who follows |
| Service or Amenity **presence** changed | false negatives are common (a riser under leaves); management may send someone to re-check |

A Ticket raised against a proposed new Location is attached to the
proposed **parent** Location, carries the Proposal, and is re-targeted to
the created Location on approval. On rejection it stays on the parent.

### Search fields that don't erase

When recording a Boat, the auditor may type a name, get no match, then type
a registration and get a match (or the reverse). The matched record is
loaded **without discarding** what was typed in the other field; the typed
value is offered as an update to the matched record's empty or differing
field. Same for Contacts (name, phone).

### GPS capture

Shown when the target has no coordinates, or the device's fix is farther
from the recorded ones than the marina's **audit GPS radius** setting (a
new `marina_settings` column, distinct from the checkpoint validation
radius).

- The device's reported accuracy must be within the marina's **audit GPS
  accuracy** setting (default 10 m). Otherwise the prompt shows the current
  accuracy ("GPS accuracy 23 m — move into the open and try again") and
  the capture button is disabled.
- The auditor must tick *I am standing directly at &lt;Location&gt;* before
  the capture button enables. The prompt never assumes they are.
- The capture is a **Proposal** (see above), recorded with the fix and its
  accuracy.

## Closing

An Audit becomes **Closed** when:

- every target has a Finding, automatically; or
- a User with `manage_audits` closes it early. Remaining targets are
  marked *Not Audited*, reason "closed early".

A target is also marked *Not Audited*, reason *retired by Audit &lt;name&gt;*,
when another Audit's finalize retires it. If one Audit proposes retiring a
Location that another Audit has a normal Finding for, both are left for the
finalizer to see; nothing is resolved automatically.

Closed Audits accept no Findings. There is no reopening; launch a new Audit
over the same rules instead, so every Finding belongs to one point in time.

## Finalizing

The finalize screen for a Closed Audit shows:

1. **Summary**: targets, audited, not audited, Unexpected Occupancy count,
   Tickets and Incidents raised.
2. **Unexpected Occupancy** list, with the Finding and the Lease or
   Reservation on file (or its absence).
3. **Proposals** in a table, one row each, with a checkbox column for bulk
   approve or bulk reject, and a per-row reason field for rejections.
   Rows the User lacks the permission for are shown but disabled.

Decisions save one at a time; the screen may be left and returned to over
days. **Finalize** enables when every Proposal has a decision, and requires
`manage_locations` when any structural Proposal exists. On finalize:

- Approved Proposals apply, each with an Activity Log entry naming the
  Audit and the approver.
- An approved *retire* marks the Location **Retired**: hidden from pickers,
  maps and future targets; history and attachments kept. When the Location
  has **no history** — no Ticket, Note, Incident, Lease, Reservation,
  Checkpoint, child Location, ever-recorded Boat or Vehicle, or Finding from
  an earlier Audit — it is deleted instead, on the reading that it was
  created in error.
- Rejected Proposals stay recorded with their reason. A rejection is final
  for this Audit; any re-check is a new Audit launched by hand.
- The Audit becomes **Finalized**.

## Implementation notes

Built 2026-09-22 on `beta2`. Where the code lives:

- `src/lib/auditRules.ts`, `src/lib/audits.ts` — the pure decisions, fully
  unit-tested.
- `src/data/audits.ts`, `src/data/services.ts` — the data layer. Closing
  and finalizing are RPCs (`close_audit`, `finalize_audit`); everything else
  is a local write that syncs.
- `src/pages/audits/` — the section, home, launch, detail/finalize and
  Finding pages, and the rule-tree editor. `src/pages/admin/AdminServicesPage`
  and `AdminAuditTemplatesPage`. `src/pages/locations/LocationServicesPanel`.
- `supabase/migrations/20260922000{2,3,4}00_*.sql`; `supabase/tests/080_audits.sql`.
- `scripts/e2e/audits.mjs` drives tests 35–42 of the approved list against
  a running app.

One thing in this spec is satisfied differently from how it reads:

- The **displaced** flag lives on the target (`audit_targets.displaced_note`),
  not on a placeholder Finding, so that writing it never marks the target
  audited. The spec's "or a placeholder if none yet" is satisfied that way.

## Out of scope, recorded

- Scheduling (rolling "x per night", random spot audits). Manual launch only.
  Templates and the *last audited before* predicate exist so scheduling can
  be added without a new concept.
- Marina Zones for distance sorting. `docs/TODO.md`.
- Billing from meter readings. ADR 0007 keeps the reading billable-party
  free so billing can derive it later.
- Removing the hardcoded "Marina Manager" / "Owner" role names in the home
  dashboard layout. Pre-existing; unrelated to this feature.
