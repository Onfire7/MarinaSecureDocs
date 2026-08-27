# Coverage log

Every file in `src/lib` and `src/data` that the unit suite does not fully
cover, and why.

The point is not to reach a number. It is that **an untested file should be a
decision, not an accident** — so `scripts/coverage-check.mjs` fails if a file
sits at zero coverage without an entry here. Adding a file to this list is
cheap; forgetting one should not be silent.

Run `pnpm run test:coverage` then `pnpm run coverage:check`.

## Fully covered

`contacts.ts` · `detId.ts` · `geo.ts` · `permissions.ts` · `search.ts` ·
`shiftReport.ts` · `data/attachments.ts` · `data/sql.ts` — 100%.

`permissions.ts` matters most: its assertions are the executable
specification for the `effective_permissions` SQL view that replaces it (see
[Permissions — Enforcement](../permissions.md)).

## Zero coverage, by reason

### The data layer — SQL is not what a unit test can check

| File | Note |
|---|---|
| `data/activity.ts` | Feed queries + the activity write. |
| `data/boats.ts` | Boats, vehicles, their owners, and moving one. |
| `data/checkins.ts` | Check-in queries and the write. |
| `data/checklists.ts` | Templates, instances, and the submit transaction. |
| `data/checklistInstantiation.ts` | Materializing a template into rows. |
| `data/checklistSubmit.ts` | Deferred effects at submit. |
| `data/checkpoints.ts` | Checkpoints and tours. |
| `data/comms.ts` | Calls, SMS, chat. |
| `data/contacts.ts` | Contacts and their details. |
| `data/files.ts` | Attachment rows and Storage uploads. |
| `data/incidents.ts` | Incidents, comments, the author-edit window. |
| `data/leases.ts` | Leases, lessees, documents, comments. |
| `data/locations.ts` | Locations, types, maps, placements. |
| `data/lookups.ts` | The admin-defined status and type tables. |
| `data/notes.ts` | Notes on a target. |
| `data/reservations.ts` | Bookings, conflicts, check-in/out. |
| `data/settings.ts` | Marina settings and phone lines. |
| `data/setup.ts` | The Setup Wizard's chunked plan runner. |
| `data/shifts.ts` | Shifts. |
| `data/tickets.ts` | Tickets. |
| `data/users.ts` | Users and roles. |

An earlier version of this log promised these would get unit tests after
cutover, "against `src/data/` modules whose seam is designed to be testable".
That promise was made against a wrong guess about the shape of the seam.

What these modules contain is SQL text and a call that runs it. A unit test
could assert that a query string says what someone typed, which proves nothing
anybody wants proved — the questions that matter are whether the SQL returns
the right rows, whether RLS lets the write through, and whether the row reaches
the device at all. None of the three can be answered without a database. They
are answered by `supabase/tests/` (55 pgTAP assertions over permissions, RLS,
constraints and the sync windows) and by driving a real signed-in session, which
CLAUDE.md already names as the only thing that counts as verification here.

Two files in the layer are NOT that, and both are tested: `data/sql.ts`, through
which every write in the app passes, and `data/attachments.ts`, which resolves
the one-of-six target pattern. The pure rules the data layer calls into —
permissions, checklist rule resolution, contact merging, shift windows — live in
`src/lib` and are tested there.

### Browser-API surfaces — a real session is the honest check

| File | Depends on |
|---|---|
| `appUpdate.ts` | Service worker registration and the waiting-worker lifecycle |
| `pwaInstall.ts` | `beforeinstallprompt` |
| `theme.ts` | `matchMedia`, `localStorage` |
| `nfc.ts` | `NDEFReader` (Web NFC) |
| `config.ts` | `import.meta.env` — build-time values with no logic beyond a missing-key list |

Each needs jsdom plus hand-written mocks, and what the test would then verify
is that the mocks were called. The actual risk is device behaviour — an
iPhone that won't scan, a service worker that installs but never activates —
which only driving a real session catches. `CLAUDE.md` already requires that.

### Not meaningfully assertable

| File | Note |
|---|---|
| `nameGenerator.ts` | Randomized output; the only stable property is "returns a non-empty string". |
| `workItems.ts` | `PRIORITY_ORDER` plus two badge-class `switch` statements. |
| `assets.ts` | Mostly labels and badge classes. **`meterSummary` and `formatNumber` do have real formatting logic and are worth testing** — not yet done, deliberately deferred rather than overlooked. |

A test asserting a `switch` returns what the `switch` returns restates the
code. These change with CSS, and the test would change with them, catching
nothing.

## Partial coverage

| File | % | What's uncovered |
|---|---:|---|
| `checklists.ts` | 59% | Display-label maps (`ITEM_TYPE_LABEL`, `triggerTypeLabel`, `doorStateLabel`) and the summary formatters. The **scheduling** logic — recurrence, hide-until, due-by, visibility — is covered, which is the part with behaviour. |
| `locations.ts` | 35% | `statusBadgeClass`, `statusMapColors`, `placementStyle` — presentation. `compareNames` and `breadcrumb` are covered. |
| `reservations.ts` | 63% | `reservationStatusBadgeClass`. The overlap and billing logic is covered. |
| `data/attachments.ts` | 100% | — |
| `comms.ts` | 88% | `twilioRequest` — a `fetch` against a bridge that isn't deployed. |
| `checkpoints.ts` | 91% | One sort tiebreak. |
| `maintenanceRules.ts` | 92% | One baseline fallback branch. |
