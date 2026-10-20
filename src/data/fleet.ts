import { useQuery } from "@powersync/react";
import type { LockContext } from "@powersync/web";
import { stamp } from "../lib/db";
import { insert, transact, update } from "./sql";
import { recordActivity } from "./activity";
import {
  meterRulesDue,
  writeMeterReading,
  type AssetRow,
} from "./assets";
import { readingChange } from "../lib/fleet";

// Fleet Vehicles — the Dashboard's Fleet card (src/pages/home/FleetCard.spec.md).
//
// A Fleet Vehicle is an Asset with is_fleet set, so every write here is an
// ordinary Asset write — a checkout, a meter reading, a status entry — plus
// the fill-up, which is the one record of its own. Each action is one
// transaction with its activity entry, and any reading it takes goes through
// the same maintenance check as Asset Detail and checklists.

export interface FleetVehicleRow extends AssetRow {
  checkout_person_id: string | null;
  checkout_odometer_out: number | null;
  last_checkin_at: string | null;
  last_checkin_level: number | null;
  last_fill_at: string | null;
}

// Every join is on an id: a join on anything else is a full scan per row on
// the device (CLAUDE.md § Learnings). The open checkout, the last check-in
// that recorded fuel, and the current status are each picked by a correlated
// subquery and joined on the id it returns.
const FLEET_SELECT = `
  SELECT a.*,
         l.name AS location_name,
         sl.status_id,
         st.name AS status_name,
         co.id AS checkout_id,
         co.time_out AS checked_out_at,
         co.person_id AS checkout_person_id,
         co.odometer_out AS checkout_odometer_out,
         p.name AS checked_out_to,
         lc.time_in AS last_checkin_at,
         lc.fuel_level_in AS last_checkin_level,
         (SELECT max(f.timestamp) FROM asset_fuel_logs f WHERE f.asset_id = a.id) AS last_fill_at
    FROM assets a
    LEFT JOIN locations l ON l.id = a.location_id
    LEFT JOIN asset_status_logs sl
           ON sl.id = (SELECT s2.id FROM asset_status_logs s2
                        WHERE s2.asset_id = a.id
                        ORDER BY s2.timestamp DESC, s2.id DESC LIMIT 1)
    LEFT JOIN asset_statuses st ON st.id = sl.status_id
    LEFT JOIN asset_checkouts co
           ON co.id = (SELECT c2.id FROM asset_checkouts c2
                        WHERE c2.asset_id = a.id AND c2.time_in IS NULL
                        ORDER BY c2.time_out DESC LIMIT 1)
    LEFT JOIN contacts p ON p.id = co.person_id
    LEFT JOIN asset_checkouts lc
           ON lc.id = (SELECT c3.id FROM asset_checkouts c3
                        WHERE c3.asset_id = a.id AND c3.fuel_level_in IS NOT NULL
                        ORDER BY c3.time_in DESC LIMIT 1)
   WHERE a.is_fleet = 1`;

export function useFleetVehicles() {
  return useQuery<FleetVehicleRow>(FLEET_SELECT);
}

/** How many Fleet Vehicles the marina has: the card hides at none. */
export function useFleetVehicleCount(): number {
  const { data } = useQuery<{ n: number }>(
    "SELECT count(*) AS n FROM assets WHERE is_fleet = 1",
  );
  return data[0]?.n ?? 0;
}

export interface FleetPersonRow {
  id: string;
  name: string;
  contact_id: string | null;
  active: number;
}

/**
 * Users with a linked Contact. A checkout names a Contact, and staff Contacts
 * are rarely on the device (they sync to view_owner holders, and only for
 * residents), so users — always synced — stand in for them. The inactive ones
 * are kept for naming who still holds a vehicle; the picker drops them.
 */
export function useFleetPeople() {
  return useQuery<FleetPersonRow>(
    "SELECT id, name, contact_id, active FROM users WHERE contact_id IS NOT NULL ORDER BY name",
  );
}

export interface FuelLogRow {
  id: string;
  asset_id: string;
  gallons: number;
  cost: number | null;
  odometer: number | null;
  timestamp: string;
  logged_by_id: string | null;
  logged_by_name: string | null;
}

export function useFuelLogs(assetId: string | undefined, limit = 25) {
  return useQuery<FuelLogRow>(
    `SELECT f.*, u.name AS logged_by_name
       FROM asset_fuel_logs f
       LEFT JOIN users u ON u.id = f.logged_by_id
      WHERE f.asset_id = ? ORDER BY f.timestamp DESC LIMIT ?`,
    [assetId ?? "", limit],
  );
}

/** An odometer as entered in a fleet dialog. Null when the vehicle has no meter. */
export interface OdometerEntry {
  value: number | null;
  /** Required when the value is below the current reading. */
  correctionReason: string | null;
}

/** Common to every fleet write. */
export interface FleetContext {
  /** The first non-terminal ticket status, for maintenance the reading raises. */
  ticketStatusId: string | null;
  actorId: string | null;
}

/**
 * Read what a reading would make due, then hand back a writer to run inside
 * the action's transaction. An unchanged odometer writes nothing: every dialog
 * prefills it, and leaving it alone isn't a reading.
 */
async function prepareReading(
  vehicle: AssetRow,
  odometer: OdometerEntry,
  ctx: FleetContext,
): Promise<(tx: LockContext) => Promise<string[]>> {
  const change = readingChange(vehicle.meter_reading, odometer.value);
  if (change === "none" || odometer.value == null) return async () => [];
  if (change === "correction" && !odometer.correctionReason?.trim()) {
    throw new Error("A lower odometer reading needs a reason.");
  }
  const value = odometer.value;
  const due = await meterRulesDue(vehicle, value);
  return (tx) =>
    writeMeterReading(
      tx,
      vehicle,
      value,
      "manual",
      change === "correction" ? odometer.correctionReason!.trim() : null,
      ctx.ticketStatusId,
      ctx.actorId,
      due,
    );
}

export async function checkOutFleetVehicle(
  vehicle: AssetRow,
  person: { contactId: string; name: string },
  odometer: OdometerEntry,
  ctx: FleetContext,
): Promise<string[]> {
  const writeReading = await prepareReading(vehicle, odometer, ctx);
  return transact(async (tx) => {
    await insert(tx, "asset_checkouts", {
      asset_id: vehicle.id,
      person_id: person.contactId,
      checked_out_by_id: ctx.actorId,
      time_out: stamp(),
      odometer_out: odometer.value,
    });
    const raised = await writeReading(tx);
    await recordActivity(tx, {
      eventType: "asset.checked_out",
      summary: `${vehicle.name} checked out to ${person.name}`,
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId: ctx.actorId,
    });
    return raised;
  });
}

export async function checkInFleetVehicle(
  vehicle: AssetRow,
  checkoutId: string,
  trip: { odometer: OdometerEntry; fuelLevel: number; note: string | null },
  postReturnStatus: { id: string; name: string } | null,
  ctx: FleetContext,
): Promise<string[]> {
  const writeReading = await prepareReading(vehicle, trip.odometer, ctx);
  return transact(async (tx) => {
    const now = stamp();
    await update(tx, "asset_checkouts", checkoutId, {
      time_in: now,
      odometer_in: trip.odometer.value,
      fuel_level_in: trip.fuelLevel,
      return_note: trip.note,
    });
    if (postReturnStatus) {
      await insert(tx, "asset_status_logs", {
        asset_id: vehicle.id,
        status_id: postReturnStatus.id,
        note: "Returned from checkout",
        timestamp: now,
        logged_by_id: ctx.actorId,
      });
    }
    const raised = await writeReading(tx);
    await recordActivity(tx, {
      eventType: "asset.checked_in",
      summary: trip.note
        ? `${vehicle.name} returned: ${trip.note}`
        : `${vehicle.name} returned`,
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId: ctx.actorId,
    });
    return raised;
  });
}

export async function logFleetMileage(
  vehicle: AssetRow,
  odometer: OdometerEntry,
  ctx: FleetContext,
): Promise<string[]> {
  const writeReading = await prepareReading(vehicle, odometer, ctx);
  return transact((tx) => writeReading(tx));
}

export async function logFuel(
  vehicle: AssetRow,
  fill: { gallons: number; cost: number | null; odometer: OdometerEntry },
  ctx: FleetContext,
): Promise<string[]> {
  const writeReading = await prepareReading(vehicle, fill.odometer, ctx);
  return transact(async (tx) => {
    await insert(tx, "asset_fuel_logs", {
      asset_id: vehicle.id,
      gallons: fill.gallons,
      cost: fill.cost,
      odometer: fill.odometer.value,
      timestamp: stamp(),
      logged_by_id: ctx.actorId,
    });
    const raised = await writeReading(tx);
    await recordActivity(tx, {
      eventType: "asset.fueled",
      summary: `${vehicle.name} filled with ${fill.gallons} gal`,
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId: ctx.actorId,
    });
    return raised;
  });
}

/**
 * Flag an asset as a Fleet Vehicle or unflag it. A fleet vehicle must be
 * checkoutable (Postgres checks), so flagging one also makes it so;
 * unflagging leaves it checkoutable.
 */
export async function setFleetVehicle(
  asset: { id: string; name: string },
  isFleet: boolean,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "assets", asset.id, isFleet ? { is_fleet: 1, checkoutable: 1 } : { is_fleet: 0 });
    await recordActivity(tx, {
      eventType: "asset.fleet_changed",
      summary: isFleet
        ? `${asset.name} added to the fleet`
        : `${asset.name} removed from the fleet`,
      subjectType: "assets",
      subjectId: asset.id,
      actorId,
    });
  });
}
