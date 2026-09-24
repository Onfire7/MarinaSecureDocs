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
| Record a Finding, by form or by wizard | assignment (a User or one of their Roles is an assignee). Row-level: any active marina user may insert; assignment is enforced in the UI and the data layer, matching how ticket creation is ungated. |
| Approve or reject a Proposal about Service or Amenity presence, or GPS | `manage_audits` |
| Approve or reject a structural Proposal (new, retired, renamed, retyped, reparented, re-placed Location) | `manage_locations` |
| Finalize | `manage_audits`; **and** `manage_locations` when any structural Proposal exists |
| Create or revoke a Share Link; view a report in-app | `manage_audits` to share; any User who can see the Audit to view |
| Maintain the Services and Amenities catalogue | `manage_locations` |

No role is hardcoded anywhere. "Manager" is not a term; it means "a User
with the permission the row requires".

## Attributes, Services and Amenities

Three marina-defined catalogues, edited under Admin beside Location Types.

- A **Service** is a fixed utility: 30A power, 50A power, water, sewer. It
  declares an optional **unit** (kWh, gallons) used when metered.
- An **Amenity** is an extra: WiFi, fire pit, grill, picnic table.
- An **Attribute** is what the Location enforces about what it will accept.
  It declares a **kind**: a `number` with an optional **unit** (maximum boat
  length, in ft) or a `choice` with **options** (access: back-in or
  pull-through) — the same option list an Audit Question's Choice kind uses.

Each catalogue entry names the Location Types it is **valid for**. A
Location records, for each valid entry:

- Service: present (row exists), **working** (boolean), **metered**
  (boolean), note.
- Amenity: present (row exists), note.
- Attribute: **value** (optional) — a number for a `number` kind, one of
  the options for a `choice` kind — and a note. Unlike a Service or
  Amenity, an Attribute is never present or absent — it applies to every
  Location of a valid type — so there is no separate presence to record,
  only a value that may be left blank.

Amenities of a parent (a pavilion, a bathhouse) are recorded on the parent
only; they are understood to serve its children and are not copied down.

An Attribute's value carries no "still fine" fast path the way a Service's
`working` flag does: once an Audit exists for the Location, **every**
value change — including clearing one that was set — is a Proposal, never
applied directly from a Finding. A capacity limit is worth a second look
every time it moves. The admin location editor still writes it directly,
for a Location no audit has yet looked at.

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
- for a Status Template, which built-in **categories** it asks about:
  Attributes, Services, Amenities, whether the Location is clearly marked,
  and whether it's placed correctly on the map — each a checkbox, all on
  by default. Occupancy's built-ins (`Occupied?` and its occupants) are one
  question, not a set of categories, so this doesn't apply to that kind.
- a tree of **Audit Rules**
- **Audit Questions**, each attached to one rule

Templates are edited under Admin beside Checklist Templates. Category
choices copy onto the Audit at launch, the same as the rule tree — editing
a Template's categories afterward never reaches an Audit already launched
from it.

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

**Status** — each numbered group is one of the Template's **categories**
(§ Audit Templates) and is asked only when its checkbox is on:

1. **Attributes.** For each Attribute valid for the type: value (a number
   field or a pick from its options) and note. No present/absent — it
   always applies; a blank value just means none is set. Always a Proposal
   (§ Attributes, Services and Amenities).
2. **Services.** For each Service valid for the type: present? working? note.
3. **Amenities.** For each Amenity valid for the type: present? note.
4. **Marked.** *Is this Location clearly marked?* Yes/No.
5. **Map.** *Is this Location placed correctly on the map?* The map it is
   plotted on is shown with its rectangle highlighted (its nearest
   ancestor's map when it is plotted nowhere); tapping a new spot is a
   `move_placement` Proposal and answers No.

Every section opens **pre-filled from what the marina already knows** — a
Service that's on file starts on *Present* with its working flag and note,
an Attribute with its recorded value. The auditor confirms what's there and
changes what isn't, rather than entering a Location from scratch.

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

## The wizard

Settled with the owner on 2026-09-23, by prototype (branch
`prototype/audit-wizard`, four variants; the chosen one is D, the owner's
own design). The Finding form asks everything about one Location at once,
which is right when you are standing at one Location and wrong when you
are walking fifty. The **wizard** is the walking tool: pick what this run
asks about, then go through the Locations answering one thing at a time.

It is repeatable and exitable, and it is **an aid, not the audit**. Nothing
it records differs from what the Finding form would have recorded, and
either may be used on the same Location. A sweep of one item across the
property is simply another run with one item selected.

### Starting a run

*Wizard* sits on an Open Audit's page, and on the Audits section when it
shows a single Audit - a guard in the field may never open the audit page.
It is open to anyone who may record a Finding; a Closed Audit has none to
record and says so.

The first screen is the **item list**: every entry this Audit could ask
about, grouped - Status (or Occupancy), Attributes, Services, Amenities,
Questions, Checks, GPS - each group headed by a checkbox that takes the
whole group, and **everything selected**. Most runs want everything; a
sweep turns the rest off. Under it, the **Locations** the run walks:
*Still to do* by default, or all of them including those already audited.
The foot of the screen counts what was chosen - "12 locations · 147 steps".

### Walking it

A run is **location-major**: every selected item of one Location, then the
next. Items that do not apply are never shown - a Service the Location's
type does not have, a Question no Rule attached to it, GPS on a Location
that already has a pin.

Each item opens **pre-filled from what the marina already records**, with
an *On file:* line saying what that is, so the auditor is confirming
rather than entering (§ Field work). Answering moves to the next logical
field: an answer that reveals something - a Service found Present, which
wants its working flag and note - moves into that, and one that reveals
nothing moves to the next item.

The on-screen keyboard is allowed to cover the pager, and never the
question: the pages shrink to what is still visible, over 250ms, and the
question stays centred in it. Arriving at an item with nothing to type
into dismisses it.

The run reports progress as **what it has touched**, not what has a value:
a Location pre-filled from six months ago is not a Location anyone looked
at today.

### Saving

**Every answer is written the moment it is made.** Losing four-fifths of a
Location because a phone slept, or because a thumb found Back, is worse
here than on the Finding form, which at least holds one Location's work.

**An item that changed nothing writes nothing**, so walking through a
Location without answering anything leaves it Pending and records nothing;
scrolling past is not auditing.

Each write touches **only the item it was given**. A run that asks about
Power leaves the amenities an earlier run recorded exactly as they were -
`saveFinding()` rewrites a Finding's parts wholesale and would erase them,
so the wizard has its own writer (`src/data/auditWizard.ts`). Re-answering
an item replaces the Proposal it made rather than adding a second one, and
answering back to what is on file withdraws the Proposal entirely.

The first answer at a Location **creates its Finding**, unconfirmed
(§ Confirming a Location). Recording is not finishing: a run is expected
to be a slice, and the Location stays in the queue until somebody says it
is done.

What applies at once and what waits for approval is unchanged
(§ What applies immediately). A Yes/No Question that raises a Ticket on No
raises it here too, once.

### Reopening an Audit

An Audit closes itself when no target is left pending, and closes early
when someone says so. Both are undone by **Reopen**, on the Audit's page
for `manage_audits` - the same key that closed it.

It restores exactly what the close took: targets marked *Not Audited*
with the reason *closed early* go back to Pending. A target marked Not
Audited for its own reason keeps it, and a Location that was properly
signed off stays Audited - an Audit being reopened says nothing about the
Locations that were finished, and clearing them would throw away the
record of who finished what.

**A reopened Audit never closes itself again.** Reopening one whose
targets are all confirmed would otherwise last until the next Finding
write tripped the auto-close, which is the opposite of what was asked
for. `audits.reopened_at` records the reopening and stands the auto-close
down for good; Close early is still there, and is now the only way that
Audit closes.

A **finalized** Audit is not reopened. Finalizing is the one path from an
Audit into marina structure - Locations created, Attributes applied,
Proposals spent - and a second pass over decisions already acted on is a
different and much worse problem than a shift that ended early.

### Confirming a Location

The last page of every Location is **the Location itself**: every item
this Audit asks about it, as it now stands, and a button that marks it
Audited. Under each item is what has been recorded - by this run, by the
pass before it, or, failing both, what is on file - and items with nothing
behind them say *not answered*, so a gap is seen before the sign-off
rather than afterwards on the Audit page.

It is an item like any other, offered under Status (Occupancy on an
Occupancy audit) and turned off like any other, and it is always asked
last: there is nothing to confirm before the questions have been asked.

What it writes is `audit_findings.confirmed_at`, and a Location is
**Audited exactly while that is set** - a database trigger keeps the
target in step, and the Audit closes itself when the last Location is
confirmed rather than when the last answer lands. *Reopen* clears it and
hands the Location back to the queue with every answer still recorded
against it. So several passes can accumulate - the pedestals this morning,
the fire rings on Thursday - and the sign-off happens once, when the
auditor is ready.

A run with the page turned off has no other moment to make that
statement, so its Findings are **born confirmed**: answering is all it
says, which is what the wizard did before this page existed. The Finding
form is the same case - it shows the whole Location at once, so saving it
confirms.

### Jumping about

The locations are a filterable list - search, and *Still to do* / *Done* /
*All* with counts, where Done means confirmed (or touched by this run) - reached from the bottom bar on a phone and always
visible in the sidebar on a desktop. Picking one goes there. Next and
Previous move a Location at a time.

Nothing about a run is stored: the selection and the position live for as
long as the screen does. Switching devices means starting a run, which
costs a few taps and is the honest answer for a tool that is navigation
rather than record.

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

## Confirming an Audit is complete

A Location can be *Audited* and still have nothing on file for half of what
the Audit asks. The audit page therefore carries a **pill per category** —
Services, Amenities, Attributes, Questions, GPS, Marked, Map — for every
category the Audit asks about that still has an unanswered item on a
Location that **has** been audited. Each pill names the category and how
many audited Locations it is unanswered on; tapping one filters the
Locations list to exactly those, and the row itself says what it has no
answer for.

A category the Template switched off is never unanswered, and an Occupancy
Audit has only Questions and GPS. *Not Audited* Locations are not gaps —
they are already their own count — and neither are pending ones.

What counts as unanswered is, per category:

- a **Service** or **Amenity** valid for the Location's type that the
  Finding holds no answer for at all. This is normal and not an error: the
  catalogue gained an entry, or the entry became valid for the type, after
  that Location was audited.
- an **Attribute** the Location has no value for, and this Finding proposed
  none — nobody knows it yet.
- a **Question** the Rules attached to the target with no answer recorded.
- **GPS**: the Location has no coordinates and the Finding carries no GPS
  Proposal.
- **Marked** and **Map**: the built-in Yes/No left blank.

When nothing is outstanding the pills are replaced by the sentence that
says so, because "no pills" and "nothing loaded yet" must not look alike.

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
- The **Audit Report** is compiled and stored (`audit_report_snapshots`).
  From here on every view of the report, shared or in-app, is that
  snapshot - see § Sharing the results.
- The Audit becomes **Finalized**.

## Sharing the results

Settled with the owner 2026-09-23, by prototype (branch
`prototype/audit-report`, four variants; the chosen one is D, a combination
of B's dashboard band with A's summary and attention list). The audience is
the **Marina Management Team**: people who run the marina and may not use
the app, reading on a laptop or a phone, and who will paste the numbers
into a spreadsheet.

### The Audit Report

The **Audit Report** is one document compiled from one Audit, read outside
the app. It is the same document whether it is viewed in-app, by a Share
Link, or - later - attached to an email. It contains, in order:

1. **Header.** Marina name, audit name, kind, the status word (*Closed -
   awaiting decisions* / *Finalized*), launched / closed / finalized dates,
   who audited, and either *as of &lt;time&gt;* (Closed) or *finalized
   &lt;date&gt;* (Finalized).
2. **Executive summary.** Sentences, not numbers - the paragraph a manager
   would otherwise have to write, set as prose under the header, not in a
   card: who audited how many of what between which dates and how many
   were not reached; what was found not working, by service; signage and
   mapping; changes proposed and their decisions; tickets raised and open.
   For an Occupancy Audit: occupied, vacant, and how many did not match
   the file.
3. **Headline numbers.** A row of tiles: Locations; Audited (percent, n of
   N); *Not working* services (Status) or *Unexpected* occupancy
   (Occupancy); locations that *Need attention*; Changes (n, approved,
   undecided); Tickets open (of raised).
4. **Charts**, a band of three cards. Coverage: a bar (audited / not
   audited / pending, every segment labelled). Status: per-service
   *present* counts and, when any, *not working*. Occupancy: occupied /
   vacant. Then each Question's tally. Single-hue bars, value at the tip -
   never a pie.
5. **Needs attention.** One line per Location, in tree order: what is wrong
   there, in words. A Location needs attention when any of: a Service
   present but not working (with its note); **a note on any other Service
   or Amenity**; *clearly marked* = No; *placed correctly* = No; Unexpected
   Occupancy; a Yes/No Question answered No; a Ticket raised from its
   Finding still open.
   - **A note is always a reason to look.** Somebody typed it on a phone,
     in the rain; they do that when there is something to say. It is the
     same text as the Notes column, so a reader is not made to
     cross-reference two tables to find "tap drips". A note on a Service
     that is *not working* is already the reason for that line and is not
     repeated.
   - **An undecided Proposal is not one of them**, and nor is it a row in
     the per-item tab. Every Attribute answer is a Proposal by design, so
     an audit of any size carries hundreds before it is finalized - the
     Campgrounds audit carried 402 - and listing each one put every
     Location in the list and buried the things that are actually wrong.
     Proposals awaiting a decision belong to the approval queue on the
     Audit's page, where they can be acted on; the report gives the count
     in one line of the summary and marks a proposed value with `*` where
     it stands. A **decided** Proposal is an outcome, and stays.

6. **Results**, two tabs, one filter row (state: all / needs attention /
   audited / not audited; search):
   - **Per location** (default): one row per target. Columns: Location,
     then **one column per thing the Audit asked about** - *Occupied* for
     an Occupancy Audit; each Attribute, Service and Amenity valid for any
     target's type, in that order and each in catalogue order; each Audit
     Question; *Marked* and *Map* for a Status Audit, each only when its
     category is switched on - then Notes. The Location's type and an Area
     column (the parent Location) appear only when the targets differ in
     them: an audit of one campground needn't say "Campsite · Campgrounds"
     fifty times. There is no State column: a row that needs attention is
     marked at its left edge, and a Location that was not audited is
     dimmed, its cells all `-`, its Notes cell reading *not audited ·
     closed early*. Changes, Tickets and who recorded the Finding are not
     on the page; the exports carry them, with State, Type and Area always
     present - a spreadsheet has no left edge. Cells are short fixed words
     so a column filters and pivots:

     | Column | Cell |
     |---|---|
     | Service | `Working` · `Not working` · `Absent` · `-` |
     | Amenity | `Yes` · `No` · `-` |
     | Attribute | the value with its unit, e.g. `38 ft`, `Back-in`; `*` after it when this Audit proposed it |
     | Question | `Yes` · `No` · the option chosen · the text · `-` |
     | Marked, Map | `Yes` · `No` · `-` |
     | Occupied | `Occupied` · `Vacant`; `!` after it when it does not match the file |
     | Notes | the Finding's service and amenity notes, `Service: note; …` |

     `-` means *not recorded*: the Location was not audited, or the entry
     was added to the catalogue after it was. The first column stays put
     under horizontal scroll; the table is meant to be wider than a phone.
   - **Per item**: one row per Location × item - Occupancy, Attribute,
     Service, Amenity, Question, Marked, Map, Change, Ticket - with Result
     and Note; the Area column follows the same rule.
     The "every place where Water is absent" view.

**Left out, on purpose.** Contact names and details, boat and vehicle names
and registrations, GPS coordinates (a captured fix shows only as a change),
and the *still unanswered* completeness gaps - those are an internal
measure and stay on the audit page. Auditors' names and their notes are
in: they are about the Location, and the reader is management.

**Theme.** The app's own tokens and type; follows the viewer's light or
dark preference; print is always light and drops every control. The
marina's name is text; there is no logo yet.

### Share Links

A **Share Link** is a public URL, `/r/<key>`, whose key is a random UUID.
Its domain is the **deployment's public address** (`VITE_PUBLIC_URL`, which
netlify.toml fills from Netlify's `$URL`), never
`window.location.origin` - a link built from wherever the app happened to
be open carries that address to its recipient, and one of this repo's two
sites is a different build with no `/r/` route, so a link that lands there
asks them to sign in. Unset, it falls back to the current origin, which is
right for localhost.
Anyone holding it sees the Audit Report; the key is the whole credential,
so it is treated like one. A User with `manage_audits` creates them from any Audit's page. A link
to an **Open** Audit is a progress link - the same report, compiled on
every open, with what is still to visit counted. Each link is its own row
(`audit_shares`):

- a **label** naming who it went to ("Ownership group", "Bob");
- **expires** - 90 days by default, or never;
- **revoked** - immediate and permanent; to re-share, make a new one;
- **views** and **last viewed**, bumped on every successful open;
- a **filter**: what this link leaves out (§ A link can show less).

The audit page lists its links with those facts, *Copy link* and *Revoke*.
Expired, revoked and unknown keys all land on the same neutral page -
*This report link is no longer active. Ask the marina for a new one.* - so
a key cannot be probed for existence.

### A link can show less

Different readers need different parts. The ownership group wants the
condition of the property; a contractor wants the sites they are quoting
and nothing else; nobody outside the office needs the GPS fixes. So a
Share Link carries a **filter**, chosen when the link is made, and what it
hides is hidden **as if the Audit had never asked**.

That last part is the whole requirement, and it is why the filter is not a
checkbox on the page. **The filter is applied in the database**, to the
compiled document, before it is sent: `audit_report(key)` hands what it
loaded to `filter_audit_report(doc, filter)`. The recipient's copy simply
does not contain the hidden parts - not in the tables, not in the export,
not in the page source, and not in the numbers, because every number in
the report is derived from that document by the client. A report with
Services filtered out says nothing about services anywhere: no column, no
*not working* tile, no sentence in the summary, no line in *Needs
attention*, and `includeServices` reads false, so the reader cannot tell
the Audit ever asked.

A filter names two things, and an empty filter shows everything:

- **Items**, by category and by entry. Whole categories - Occupancy,
  Attributes, Services, Amenities, Questions, *Marked*, *Map*, GPS,
  Changes, Tickets - or single entries within one: keep Services but drop
  *Sewer*, keep Questions but drop one prompt. GPS is the `set_gps`
  Changes, which is the only place a fix appears in a report; hiding
  Changes hides those too.
- **Locations**. Empty means every target. Otherwise only those targets
  appear, and the totals are of that subset - the link reads as an audit
  of the campground, not as an audit of the marina with most of it
  missing.

Entries are stored **by id and resolved to names when the report is
built**, never stored as names. The document identifies a Service by its
name, so a filter written as text would stop matching the day somebody
renames it - and a privacy filter that stops matching fails by *showing*
what was meant to be hidden. Ids are resolved in the same breath as the
document is compiled, so a rename moves both sides together.

The filter is fixed when the link is made. To change what somebody sees,
revoke and make another - a link's meaning never changes under the person
holding it. The creator checks what a link shows by opening it.

The in-app report at `/audits/:id/report` is **never** filtered: it is the
Audit itself, for people who may already see all of it.

### Live, then static

While the Audit is **Open or Closed**, every view compiles the report from
current data and says *as of &lt;time&gt;*: findings recorded in the field
and decisions made on the finalize screen show up on the next open. On
**finalize** the compiled document is stored and every later view - shared
or in-app - is that snapshot, verbatim. A Finalized Audit's report never changes, even when a ticket it
raised closes or a Location it names is renamed next year.

### In the app

The same report renders in-app at `/audits/:id/report` for any User who
can see the Audit, with two differences: Location names link to their
Finding, and the page sits inside the shell. The public page has no shell,
no sign-in and no local database - it fetches the document once.

### Export

*Export…* asks two things and then does them:

- **Formats**, any combination of **PDF**, **Excel**, **CSV**.
- **Rows**: *Per location*, *Per item*, or *both* - each as currently
  filtered.

CSV writes one file per chosen row set with exactly the table's headers.
Excel writes one workbook: a *Summary* sheet (the headline numbers and the
executive summary sentences) plus a *Locations* and/or *Items* sheet. PDF
is the browser's print of the page for now, styled for paper; a
server-rendered PDF arrives with the emailed report. Files are named
`<audit name> - locations.csv`, `… - items.csv`, `<audit name>.xlsx`.

### Later, recorded

- **Emailed report.** The executive summary sentences are the body, the
  snapshot the attachment, the Twilio/SendGrid path the shift report uses
  the transport. The sentences are a pure function so the email renders
  them without a browser.
- **Shift reports** will move onto this document shape - headline numbers,
  sentences, attention list, rows - which is why the shape is generic.

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
- `supabase/migrations/20260922000{2,3,4,7,8,9}00_*.sql`; `supabase/tests/080_audits.sql`.
- `scripts/e2e/audits.mjs` drives tests 35–42 of the approved list against
  a running app.
- `src/pages/audits/CategoryCheckboxes.tsx` — the five category checkboxes,
  shared by the Template editor and the launch page. It emits only the
  changed key, never the whole row: a caller that saved the full row on
  every click could lose one change to a second click that raced ahead of
  the first one's round trip through the live query.

One thing in this spec is satisfied differently from how it reads:

- The **displaced** flag lives on the target (`audit_targets.displaced_note`),
  not on a placeholder Finding, so that writing it never marks the target
  audited. The spec's "or a placeholder if none yet" is satisfied that way.

Two bugs the build turned up, both fixed before this shipped:

- `createAuditTemplate()` never wrote the five category columns locally,
  relying on Postgres's column default. PowerSync's local row is a JSON
  blob of only the keys actually written, so the first click on a category
  checkbox tried to PATCH a row where those columns read as SQL NULL —
  `not null` refused it, and the connector discarded the write outright.
  Every `not null default` column an `insert()` call in this codebase
  writes now sets it explicitly, matching the convention `audit_targets`
  and `audit_findings` already followed for `is_current`.
- The category checkboxes originally saved the whole `AuditCategoryFlags`
  row on every click, rebuilt from the component's current prop. Two
  clicks close enough together raced: the second click's spread of the
  (still-stale) prop silently reverted the first click's change once its
  write landed. Fixed by having `CategoryCheckboxes` emit a one-key patch.

**Corrected after the first build shipped** (2026-09-22): Attributes were
first modeled with a presence toggle, the same shape as Services and
Amenities. The owner's correction: an Attribute is never present or
absent — it always applies to every Location of a valid type — only its
value is optional. `ObservedAttribute` and the `set_attribute` Proposal
payload dropped `present`; a null value now means "not set" or "cleared",
decided in SQL by `p.payload->'value' is not null` rather than a boolean
(migration `20260922000900`). The Choice question editor also moved from
one comma-separated text field to a proper add/remove list, so an option
that itself needs a comma has somewhere to go.

## Out of scope, recorded

- Scheduling (rolling "x per night", random spot audits). Manual launch only.
  Templates and the *last audited before* predicate exist so scheduling can
  be added without a new concept.
- Marina Zones for distance sorting. `docs/TODO.md`.
- Billing from meter readings. ADR 0007 keeps the reading billable-party
  free so billing can derive it later.
- Removing the hardcoded "Marina Manager" / "Owner" role names in the home
  dashboard layout. Pre-existing; unrelated to this feature.
