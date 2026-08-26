# Coverage log

Every file in `src/lib` that the unit suite does not fully cover, and why.

The point is not to reach a number. It is that **an untested file should be a
decision, not an accident** — so `scripts/coverage-check.mjs` fails if a file
sits at zero coverage without an entry here. Adding a file to this list is
cheap; forgetting one should not be silent.

Run `pnpm run test:coverage` then `pnpm run coverage:check`.

## Fully covered

`contacts.ts` · `detId.ts` · `geo.ts` · `permissions.ts` · `search.ts` ·
`shiftReport.ts` — 100%.

`permissions.ts` matters most: its assertions are the executable
specification for the `effective_permissions` SQL view that replaces it (see
[Permissions — Enforcement](../permissions.md)).

## Zero coverage, by reason

### Database-coupled — will be rewritten by the migration

| File | Note |
|---|---|
| `activityLog.ts` | Imports `db`. Builds transaction chunks. |
| `checklistInstantiation.ts` | Imports `db`. |
| `checklistSubmit.ts` | Imports `db`. |
| `config.ts` | Imports `db`. |

Testing these means mocking an InstantDB client that is being removed — the
tests would be thrown away with it. They get tests after cutover, against
`src/data/` modules whose seam is designed to be testable. See
[ADR 0005](../adr/0005-supabase-and-powersync-replace-instantdb.md).

### Browser-API surfaces — a real session is the honest check

| File | Depends on |
|---|---|
| `appUpdate.ts` | Service worker registration and the waiting-worker lifecycle |
| `pwaInstall.ts` | `beforeinstallprompt` |
| `theme.ts` | `matchMedia`, `localStorage` |
| `nfc.ts` | `NDEFReader` (Web NFC) |

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
| `attachments.ts` | 87% | Two label-fallback branches. |
| `comms.ts` | 88% | `twilioRequest` — a `fetch` against a bridge that isn't deployed. |
| `checkpoints.ts` | 91% | One sort tiebreak. |
| `maintenanceRules.ts` | 92% | One baseline fallback branch. |
