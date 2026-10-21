# Asset Detail

`/assets/:id`. The full record of one asset: status history, meter,
maintenance rules, checkout log and, for a Fleet Vehicle, its fill-ups.

## Purpose

Reached from the Asset List, from a Ticket, Incident or Note attached to the
asset, from a Reservation targeting it, from a Meter Reading checklist item's
asset link, and from the Fleet card's tiles by way of their Incidents and
Tickets.

## Data shown

| Field | Source | Notes |
|---|---|---|
| Name, category | `assets.name` / `category` | |
| Current status | Newest `asset_status_logs` row, with the history below it | Shown prominently; the log is what it is derived from. |
| Meter | `assets.meter_reading` / `meter_type`, or accrued hours if meterless | Recent `asset_meter_readings` below, each with its source (Manual / Checklist item) and any correction reason. |
| Location | `assets.location_id` | Reassignable by `manage_assets`. |
| Fleet | `assets.is_fleet` | A `manage_assets` holder sees a **Fleet vehicle** toggle; anyone else sees "On the Dashboard's Fleet card" when it is set. |
| Maintenance rules | `maintenance_rules` | e.g. "every 3,000 miles"; edited in Admin, read-only here. |
| Checkout log | `asset_checkouts`, newest first | Only for checkoutable assets; the open checkout, if any, highlighted at the top. A returned checkout made from the Fleet card also shows odometer out → in with the trip, the fuel level it came back with, and the return note. A checkout closed because its vehicle was kept past End of Shift reads "Kept past End of Shift" in place of a return, and the one that continues it, "Kept from the previous shift". |
| Fuel | `asset_fuel_logs`, newest first | Shown for a Fleet Vehicle, or any asset with fuel records: fill-ups (gallons, cost) and level readings from a Status Check, each with its level, odometer, who and when. |
| Reservation config | `assets.reservation_enabled` / `reservation_visibility` / `post_return_status_id` | Read-only summary, with the next upcoming reservation beside the status. |

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Log a status update | `manage_assets` | Appends an `asset_status_logs` entry, which is the new status. Putting an Out of Service vehicle back in service happens here. |
| Check out / Return | `manage_assets` | The Checkout / Return dialog (`docs/pages/asset-checkout-dialog.html`). Checkout records are within this permission's scope (`docs/permissions.md`). This is where a vehicle someone forgot to check in is returned, and where an out-of-service vehicle is checked out for its maintenance, since the Fleet card offers neither. Both fire checklist Asset triggers, for the person now holding the asset (`src/pages/admin/AdminChecklistTemplatesPage.spec.md` § Asset triggers). |
| Update the meter | `manage_assets` | The Meter Update dialog. Distinct from a Meter Reading checklist item, which is unrestricted as part of checklist completion. |
| Fleet vehicle toggle | `manage_assets` | Adds the asset to the Fleet card or takes it off. Turning it on also makes the asset checkoutable, which a Fleet Vehicle must be. |
| Add a note | None | New Note dialog, pre-attached. |
| Log an incident | `create_incidents` | New Incident form, pre-attached. |
| Create a ticket | None | New Ticket form, pre-attached. |

## States and edge cases

- **Checkout doesn't change status.** Creating a checkout writes no status
  entry; only return has a modelled status effect (the post-return status,
  else the marina's "Available").
- **Already checked out.** Check out becomes Return; an asset has at most one
  open checkout from here (the Fleet card's offline edge case aside, see
  `src/pages/home/FleetCard.spec.md`).
- **Not checkoutable.** The checkout log and its action are omitted.
- **No maintenance rules.** Shown plainly; a metered asset works fine with
  none, it just never raises tickets.

## Mobile and desktop

Mobile: sections stack vertically, the actions in the header. Desktop: the
record and its activity side by side, as on Boat and Location detail.
