# Fleet card

A Dashboard card (`DashboardPage.spec.md` § Cards) for signing the marina's
own vehicles out and in, and for logging mileage, fuel, Incidents and Tickets
against them. Built for a guard who grabs the patrol truck at the start of a
shift, but available to any role granted `use_fleet`.

The design was settled by a throwaway prototype; the variants and the verdict
are on the `prototype/vehicle-card` branch.

## Terms

A **Fleet Vehicle** is an Asset flagged `is_fleet`: the marina's own truck,
van, golf cart or trailer. It is *not* a Vehicle — that word already means a
guest's or tenant's car (`CONTEXT.md`), with its own table and pages. Every
fleet write is an ordinary Asset write (Checkout, Meter Reading), plus the
fuel records below; there is no separate fleet data model.

## Who sees it

| | |
|---|---|
| Requires | `use_fleet` (new). Governs signing fleet vehicles out and in and logging against them. Tier 2: enforced in the interface only, like `manage_assets` (`docs/permissions.md` § Enforcement). Deliberately not `manage_*`, which would also open the Admin section. |
| Default for | Security. The predefined Security role is granted `use_fleet` by a data migration; other roles get it in Admin → Roles. |
| Hidden when | The marina has no Fleet Vehicles. The card stays in the layout and reappears when one is flagged. |

`use_fleet` is the permission for the data this card writes, so the
Dashboard's rule ("a card's gate is the permission for its data") holds.

## Layout

A board of every Fleet Vehicle, ordered: **yours** (checked out to you),
then **available**, then **with someone else**, then **out of service**;
by name within each group.

**Yours: a wide tile.** Each vehicle checked out to you spans the card's full
width, tinted, with its actions always showing:

- Name; "With you · {elapsed} · {n} mi this trip" (trip miles omitted if the
  vehicle has no meter); current odometer; fuel gauge.
- A row of **Fuel · Mileage · Incident · Ticket**, and a full-width
  **Check in** under it.

**Everything else: small tiles, two to a row.** Name; one status line
("Available", "With {name} · {elapsed}", "Out of service"); odometer; fuel
gauge. Tiles that aren't available are dimmed. Tapping a tile slides its
bottom edge down to reveal that vehicle's actions; tapping it again closes it.
One drawer is open at a time, and a drawer never stretches its row-mate.

| Tile | Drawer |
|---|---|
| Available, in service | **Check out**, then Fuel · Mileage · Incident · Ticket |
| With someone else | Fuel · Mileage · Incident · Ticket. No **Check in**: a vehicle someone forgot to return is checked in on Asset Detail. |
| Out of service | None. The tile is disabled and has no drawer. |

**Out of service** means the vehicle's current Asset Status is named "Out of
Service" (compared as `statusKey`, so case and spacing don't matter): the
same name the Asset status palette already shows in red. An out-of-service
vehicle is disabled on the card, whoever holds it. Checking one out to do the
maintenance, logging its mileage, and putting it back in service all happen
on Asset Detail.

**Fuel gauge.** Five steps, E · ¼ · ½ · ¾ · F, filled to the vehicle's last
known level and coloured as low at ¼ and below. Last known level is the most
recent of: the level recorded at a check-in, or an `asset_fuel_logs` row,
which carries its level (a Status Check, or a fill-up whose level was
given) or, for a fill-up without one, means F. No record yet
shows an empty, uncoloured gauge.

### Motion

Checking a vehicle out moves its tile from the grid to the wide stack, and
checking in moves it back. The tile morphs from its old box to its new one
over about 0.6 s, the other tiles slide into place, and the dashboard cards
below the Fleet card move with its change in height. The new contents are
revealed as the box grows, never stretched, and the old contents fade quickly
so text never doubles up. Implemented with the View Transitions API; a
browser without it, or a user with reduced motion set, gets the new layout at
once. The drawer opens and closes over about 0.2 s.

## Actions

Every action is one local transaction with an activity log entry, and works
offline. Odometer fields appear only for a vehicle with a meter, labelled by
its meter type (miles or hours), prefilled with the current reading; a
vehicle with no meter has no **Mileage** button.

| Action | Dialog | Writes |
|---|---|---|
| **Check out** | Person (marina users, defaulting to you); starting odometer. | `asset_checkouts` row with `odometer_out`; a Meter Reading if the odometer changed. |
| **Check in** | Ending odometer, showing "this trip +{n}"; fuel level (five buttons, required); "Anything to report?" (optional). | Closes the checkout with `time_in`, `odometer_in`, `fuel_level_in`, `return_note`; post-return Asset Status as today; a Meter Reading if the odometer changed. |
| **Mileage** | Odometer. | A Meter Reading. |
| **Fuel** | Gallons (required, > 0); cost (optional); odometer. | An `asset_fuel_logs` row; a Meter Reading if the odometer changed. |
| **Incident** | None — opens New Incident with the vehicle as its locked target. Shown only with `create_incidents`. | Whatever New Incident writes. |
| **Ticket** | None — opens New Ticket with the vehicle as its locked target. | Whatever New Ticket writes. |

Meter Readings go through the existing `recordMeterReading`, so maintenance
rules fire exactly as they do from Asset Detail or a checklist. An odometer
below the current reading needs a correction reason, as everywhere else.

**The person picker lists marina users, not contacts.** A Checkout's person is
a Contact, but staff Contacts are generally not on the device: Contacts sync
only for residents and only to `view_owner` holders. The picker reads the
always-synced `users` table and writes the chosen user's `contact_id`. A user
with no linked Contact is not offered. Checking a vehicle out to a guest stays
on Asset Detail. On tiles, the holder's name comes from the user whose
`contact_id` matches the checkout; failing that, the Contact's name if synced;
failing that, "Checked out".

## Data changes

All additive, in one migration (`20261020000200_fleet_vehicles.sql`), then
`pnpm run schema:gen`.

- `assets.is_fleet boolean not null default false`, with a check that a fleet
  vehicle is `checkoutable`.
- `asset_checkouts`: `odometer_out numeric`, `odometer_in numeric`,
  `fuel_level_in smallint` (0–4 in quarters, checked), `return_note text`.
  All nullable: existing and non-fleet checkouts have none.
- New `asset_fuel_logs`: `asset_id` (restrict delete), `gallons numeric > 0`,
  `cost numeric >= 0` nullable, `odometer numeric` nullable, `logged_by_id`,
  `timestamp`. Needs its own Tier 0 RLS policies (the baseline loop only
  covered tables that existed when it ran) and an entry in the `marina_config`
  sync stream, which must then be re-applied to the remote PowerSync
  dashboard.
- Data: `use_fleet` appended to the predefined Security role's `allow`.

## Checklists

The same vehicles can be taken, checked and returned from a checklist: the
Fleet Vehicle Item (`src/pages/checklists/ActiveChecklistPage.spec.md`
§ Fleet Vehicle Item), which shows this card's board and tiles. Checking out
or in from this card also fires the Asset triggers of checklist templates
(`src/pages/admin/AdminChecklistTemplatesPage.spec.md` § Asset triggers),
and a guard who ends a shift still holding a vehicle is asked to check it in
or keep it (§ Ending the shift there).

## Related changes elsewhere

- **Flagging a fleet vehicle.** Add Asset gains a **Fleet vehicle** checkbox
  (only with Checkoutable ticked). Asset Detail gains the same toggle for
  `manage_assets` holders, since asset flags are otherwise set only at
  creation; turning it on there also makes the asset checkoutable. Both pages
  now have co-located specs: `src/pages/assets/AssetListPage.spec.md` and
  `AssetDetailPage.spec.md`.
- **Asset Detail's checkout history** shows odometer out/in, trip miles, fuel
  level and the return note when present, and a Fuel section lists fill-ups.
- `PERMISSIONS` gains `use_fleet`; `docs/permissions.md` catalogue and Tier 2
  list gain a row; `CONTEXT.md` gains **Fleet Vehicle** and **Fuel Log**.

## States and edge cases

- **Two vehicles out at once.** Both are wide tiles, by name.
- **Checked out to you by someone else.** It's yours: wide tile, Check in.
- **Your vehicle was checked in elsewhere** (Asset Detail, another device).
  The tile morphs back to the grid when the row syncs.
- **Two guards check out the same vehicle offline.** Both checkouts sync; the
  vehicle shows as yours on both devices until one checks in. Not prevented
  — the same is true of Asset checkouts today.
- **Vehicle unflagged while checked out.** It leaves the card; its checkout is
  closed from Asset Detail.
- **Your vehicle goes out of service while you have it.** It moves to the
  out-of-service group, disabled, and is checked in on Asset Detail.
- **Someone else forgot to check one in.** The card offers nothing; Asset
  Detail's Return closes the checkout.
- **Cost is money in the marina's currency**, shown with two decimals; no
  currency field.
