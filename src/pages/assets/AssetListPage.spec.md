# Asset List

`/assets`. Every tracked piece of equipment: vehicles, jump packs, anything
with a maintenance cycle or a checkout log.

## Purpose

Reached from the Assets nav item. Viewing has no dedicated permission (the
same pattern as Tickets, Reservations and Boats); only creating and editing
require `manage_assets` (`docs/permissions.md`). Static infrastructure with no
maintenance cycle and no checkout (a fixed gate, a pedestal) is deliberately
not an Asset at all (`CONTEXT.md`), so this list is shorter than "everything
physical at the marina."

## Data shown

| Field | Source | Notes |
|---|---|---|
| Name, category | `assets.name` / `category` | Category is a free-text grouping; renamed in Admin → Assets. |
| Current status | Newest `asset_status_logs` row | There is no status column; the newest log entry is the status. |
| Meter / hours | `assets.meter_reading` with `meter_type`, or accrued hours | A meterless asset accrues hours rather than showing a reading (`docs/data-model.md`). |
| Checked out? | Open `asset_checkouts` row (`time_in` null) | Only for checkoutable assets, naming who has it. |
| Reservable? | `assets.reservation_enabled` | Small indicator. |

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Open an asset | None | Asset Detail (`AssetDetailPage.spec.md`). |
| Add an asset | `manage_assets` | Name, category, meter (and its type), **Can be checked out**, and **Fleet vehicle**, which is enabled only while Can be checked out is ticked (`src/pages/home/FleetCard.spec.md`). Maintenance rules and reservation settings are set in Admin → Assets. A new asset has no status until someone logs one. |
| Filter by category / status / checked out | None | Client-side, over the synced rows. |

## States and edge cases

- **No `manage_assets`.** The list is fully visible; only Add and the
  status, checkout and meter actions on Asset Detail are hidden.
- **Meterless asset.** Shows accrued hours instead of a reading.
- **Empty list.** A plain empty state, reminding that fixed infrastructure
  isn't tracked here.

## Mobile and desktop

Mobile: a single filterable list, each row showing name, meter and status, or
who has it. Desktop: the same rows with status and checkout visible without
opening each asset.
