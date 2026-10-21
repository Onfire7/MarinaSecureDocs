import { useQuery } from "@powersync/react";
import type { LockContext } from "@powersync/web";
import { id as newId, stamp } from "../lib/db";
import { deterministicId } from "../lib/detId";
import { dataT } from "../i18n";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";
import {
  meterRulesDue,
  withdrawMeterReading,
  writeMeterReading,
  type AssetRow,
} from "./assets";
import { fireAssetTrigger, undoAssetTrigger } from "./assetTriggers";
import { FUEL_STEPS, readingChange } from "../lib/fleet";
import { statusCheckWrites, statusUndoReading, type FleetVehicleResult, type StatusCheckInput } from "../lib/fleetItem";
import type {
  VehicleCheckout,
  VehicleFuelLog,
  VehicleMeterReading,
  VehicleRaised,
  VehicleStatusLog,
} from "../lib/shiftReport";

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
  /** Set when the open checkout continues one kept past an End of Shift. */
  checkout_kept: number | null;
  last_checkin_at: string | null;
  last_checkin_level: number | null;
  /** The newest fuel log row: a fill-up, or a Status Check's level. */
  last_fuel_at: string | null;
  last_fuel_level: number | null;
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
         co.kept_after_shift AS checkout_kept,
         p.name AS checked_out_to,
         lc.time_in AS last_checkin_at,
         lc.fuel_level_in AS last_checkin_level,
         lf.timestamp AS last_fuel_at,
         lf.level AS last_fuel_level
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
    LEFT JOIN asset_fuel_logs lf
           ON lf.id = (SELECT f2.id FROM asset_fuel_logs f2
                        WHERE f2.asset_id = a.id
                        ORDER BY f2.timestamp DESC, f2.id DESC LIMIT 1)
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
  /** Null on a Status Check's level reading, which has no fill-up. */
  gallons: number | null;
  level: number | null;
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
  readingId?: string,
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
      readingId,
    );
}

/** A Fleet Vehicle Item answered in the same transaction as what it did. */
export interface ItemAnswer {
  itemId: string;
  result: FleetVehicleResult;
}

async function answerItem(tx: LockContext, answer: ItemAnswer | undefined, actorId: string | null) {
  if (!answer) return;
  await update(tx, "checklist_instance_items", answer.itemId, {
    result: JSON.stringify(answer.result),
    completed_at: stamp(),
    completed_by_id: actorId,
  });
}

/** Reopen an item whose effect was just undone. */
async function reopenItem(tx: LockContext, itemId: string | undefined) {
  if (!itemId) return;
  await update(tx, "checklist_instance_items", itemId, {
    result: null,
    completed_at: null,
    completed_by_id: null,
  });
}

/** The ids a checkout's own readings take, so an undo can find them. */
const tripReadingId = (checkoutId: string, end: "out" | "in") =>
  deterministicId(`fleet-reading:${checkoutId}:${end}`);

/**
 * Check a vehicle out. From a Fleet Vehicle Item, `item` names it, and it is
 * answered with the new checkout in the same transaction. Returns the
 * checkout's id.
 */
export async function checkOutFleetVehicle(
  vehicle: AssetRow,
  person: { contactId: string; name: string },
  odometer: OdometerEntry,
  ctx: FleetContext,
  item?: { itemId: string },
): Promise<string> {
  const checkoutId = newId();
  const writeReading = await prepareReading(vehicle, odometer, ctx, tripReadingId(checkoutId, "out"));
  return transact(async (tx) => {
    const at = stamp();
    await insert(tx, "asset_checkouts", {
      id: checkoutId,
      asset_id: vehicle.id,
      person_id: person.contactId,
      checked_out_by_id: ctx.actorId,
      time_out: at,
      odometer_out: odometer.value,
    });
    await writeReading(tx);
    await recordActivity(tx, {
      eventType: "asset.checked_out",
      summary: dataT("fleetActivity.checkedOut", { ns: "home", vehicle: vehicle.name, person: person.name }),
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId: ctx.actorId,
    });
    await answerItem(
      tx,
      item && {
        itemId: item.itemId,
        result: { type: "fleet_vehicle", mode: "take", checkoutId, assetId: vehicle.id },
      },
      ctx.actorId,
    );
    await fireAssetTrigger(
      tx,
      { event: "check_out", asset: vehicle, checkoutId, personContactId: person.contactId, at },
      ctx.actorId,
    );
    return checkoutId;
  });
}

export async function checkInFleetVehicle(
  vehicle: AssetRow,
  checkoutId: string,
  trip: { odometer: OdometerEntry; fuelLevel: number; note: string | null },
  postReturnStatus: { id: string; name: string } | null,
  ctx: FleetContext,
  item?: { itemId: string },
): Promise<string[]> {
  const writeReading = await prepareReading(vehicle, trip.odometer, ctx, tripReadingId(checkoutId, "in"));
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
        ? dataT("fleetActivity.returnedWithNote", { ns: "home", vehicle: vehicle.name, note: trip.note })
        : dataT("fleetActivity.returned", { ns: "home", vehicle: vehicle.name }),
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId: ctx.actorId,
    });
    await answerItem(
      tx,
      item && {
        itemId: item.itemId,
        result: { type: "fleet_vehicle", mode: "return", checkoutId, assetId: vehicle.id },
      },
      ctx.actorId,
    );
    const checkout = await tx.getOptional<{ person_id: string | null }>(
      "SELECT person_id FROM asset_checkouts WHERE id = ?",
      [checkoutId],
    );
    await fireAssetTrigger(
      tx,
      { event: "check_in", asset: vehicle, checkoutId, personContactId: checkout?.person_id ?? null, at: now },
      ctx.actorId,
    );
    return raised;
  });
}

/**
 * Undo a checkout (ActiveChecklistPage.spec.md § Edit undoes what the item
 * did): the row goes, with the reading it took and any unanswered work its
 * trigger created, and the Take item that made or showed it reopens.
 */
export async function undoFleetCheckout(
  vehicle: { id: string; name: string },
  checkoutId: string,
  actorId: string | null,
  itemId?: string,
): Promise<void> {
  await transact(async (tx) => {
    const checkout = await tx.getOptional<{ person_id: string | null; time_out: string; time_in: string | null }>(
      "SELECT person_id, time_out, time_in FROM asset_checkouts WHERE id = ?",
      [checkoutId],
    );
    if (!checkout) {
      await reopenItem(tx, itemId);
      return;
    }
    if (checkout.time_in) throw new Error("This vehicle has been checked back in.");
    await undoAssetTrigger(tx, {
      event: "check_out",
      asset: vehicle,
      checkoutId,
      personContactId: checkout.person_id,
      at: checkout.time_out,
    });
    await withdrawMeterReading(tx, vehicle.id, tripReadingId(checkoutId, "out"));
    await remove(tx, "asset_checkouts", checkoutId);
    await recordActivity(tx, {
      eventType: "asset.checkout_undone",
      summary: dataT("fleetActivity.checkoutUndone", { ns: "home", vehicle: vehicle.name }),
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId,
    });
    await reopenItem(tx, itemId);
  });
}

/**
 * Undo a check-in: the checkout reopens, and the status entry, reading and
 * unanswered triggered work the check-in wrote go. Refused once anyone has
 * taken the vehicle since.
 */
export async function undoFleetCheckin(
  vehicle: { id: string; name: string },
  checkoutId: string,
  actorId: string | null,
  itemId?: string,
): Promise<void> {
  await transact(async (tx) => {
    const checkout = await tx.getOptional<{ person_id: string | null; time_in: string | null }>(
      "SELECT person_id, time_in FROM asset_checkouts WHERE id = ?",
      [checkoutId],
    );
    if (!checkout?.time_in) {
      await reopenItem(tx, itemId);
      return;
    }
    const again = await tx.getOptional<{ id: string }>(
      "SELECT id FROM asset_checkouts WHERE asset_id = ? AND time_in IS NULL LIMIT 1",
      [vehicle.id],
    );
    if (again) throw new Error(`${vehicle.name} has been checked out again since.`);
    await undoAssetTrigger(tx, {
      event: "check_in",
      asset: vehicle,
      checkoutId,
      personContactId: checkout.person_id,
      at: checkout.time_in,
    });
    // The post-return status entry carries the check-in's own timestamp,
    // compared as a time since a synced row may spell it differently.
    await tx.execute(
      `DELETE FROM asset_status_logs
        WHERE asset_id = ? AND note = 'Returned from checkout'
          AND abs(julianday(timestamp) - julianday(?)) < 0.00002`,
      [vehicle.id, checkout.time_in],
    );
    await withdrawMeterReading(tx, vehicle.id, tripReadingId(checkoutId, "in"));
    await update(tx, "asset_checkouts", checkoutId, {
      time_in: null,
      odometer_in: null,
      fuel_level_in: null,
      return_note: null,
    });
    await recordActivity(tx, {
      eventType: "asset.checkin_undone",
      summary: dataT("fleetActivity.checkinUndone", { ns: "home", vehicle: vehicle.name }),
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId,
    });
    await reopenItem(tx, itemId);
  });
}

/**
 * A Status Check, written as it is recorded so a supervisor reading the
 * Shift Report mid-shift sees it: one fuel row with the level (and the
 * fill-up, if any), a Meter Reading if the odometer moved, and the item's
 * answer naming both.
 */
export async function recordStatusCheck(
  vehicle: AssetRow,
  input: StatusCheckInput,
  ctx: FleetContext,
  itemId: string,
): Promise<void> {
  const writes = statusCheckWrites(vehicle, input);
  const fuelLogId = newId();
  const meterReadingId = writes.reading === "none" ? null : newId();
  const writeReading =
    meterReadingId && input.odometer != null
      ? await prepareReading(
          vehicle,
          { value: input.odometer, correctionReason: input.correctionReason },
          ctx,
          meterReadingId,
        )
      : async () => [];
  const result: FleetVehicleResult = {
    type: "fleet_vehicle",
    mode: "status",
    assetId: vehicle.id,
    odometer: writes.fuelLog.odometer,
    fuelLevel: input.fuelLevel,
    ...(input.fill ? { fill: input.fill } : {}),
    fuelLogId,
    meterReadingId,
    previousReading: vehicle.meter_reading,
  };
  await transact(async (tx) => {
    await insert(tx, "asset_fuel_logs", {
      id: fuelLogId,
      asset_id: vehicle.id,
      ...writes.fuelLog,
      timestamp: stamp(),
      logged_by_id: ctx.actorId,
    });
    await writeReading(tx);
    await recordActivity(tx, {
      eventType: input.fill ? "asset.fueled" : "asset.status_checked",
      summary:
        writes.fuelLog.odometer != null
          ? dataT("fleetActivity.statusWithOdometer", {
              ns: "home",
              vehicle: vehicle.name,
              odometer: writes.fuelLog.odometer,
              fuel: FUEL_STEPS[input.fuelLevel],
            })
          : dataT("fleetActivity.status", { ns: "home", vehicle: vehicle.name, fuel: FUEL_STEPS[input.fuelLevel] }),
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId: ctx.actorId,
    });
    await answerItem(tx, { itemId, result }, ctx.actorId);
  });
}

/** Edit on a Status Check: withdraw what it wrote, and reopen the item. */
export async function withdrawStatusCheck(
  vehicle: { id: string; name: string; meter_reading: number | null },
  result: FleetVehicleResult,
  actorId: string | null,
  itemId: string,
): Promise<void> {
  await transact(async (tx) => {
    if ("fuelLogId" in result) {
      await remove(tx, "asset_fuel_logs", result.fuelLogId);
      if (result.meterReadingId) {
        await tx.execute("DELETE FROM asset_meter_readings WHERE id = ?", [result.meterReadingId]);
        const { restore } = statusUndoReading(vehicle.meter_reading, result);
        if (restore != null) await update(tx, "assets", vehicle.id, { meter_reading: restore });
      }
      await recordActivity(tx, {
        eventType: "asset.status_check_withdrawn",
        summary: dataT("fleetActivity.statusWithdrawn", { ns: "home", vehicle: vehicle.name }),
        subjectType: "assets",
        subjectId: vehicle.id,
        actorId,
      });
    }
    await reopenItem(tx, itemId);
  });
}

/**
 * Keep a vehicle past End of Shift (ActiveChecklistPage.spec.md § Ending the
 * shift): its checkout closes here with the readings and the reason, with no
 * post-return status since it never came back, and a new one opens to the
 * same person at the same moment, marked kept_after_shift. Fires no trigger:
 * nothing was really checked out or in.
 */
export async function keepFleetVehicle(
  vehicle: AssetRow,
  checkoutId: string,
  keep: { reason: string; odometer: OdometerEntry; fuelLevel: number },
  ctx: FleetContext,
): Promise<void> {
  const writeReading = await prepareReading(vehicle, keep.odometer, ctx);
  await transact(async (tx) => {
    const checkout = await tx.getOptional<{ person_id: string | null }>(
      "SELECT person_id FROM asset_checkouts WHERE id = ?",
      [checkoutId],
    );
    const at = stamp();
    const odometer = keep.odometer.value ?? vehicle.meter_reading;
    await update(tx, "asset_checkouts", checkoutId, {
      time_in: at,
      odometer_in: odometer,
      fuel_level_in: keep.fuelLevel,
      return_note: keep.reason,
    });
    await insert(tx, "asset_checkouts", {
      asset_id: vehicle.id,
      person_id: checkout?.person_id ?? null,
      checked_out_by_id: ctx.actorId,
      time_out: at,
      odometer_out: odometer,
      kept_after_shift: 1,
    });
    await writeReading(tx);
    await recordActivity(tx, {
      eventType: "asset.kept_after_shift",
      summary: dataT("fleetActivity.kept", { ns: "home", vehicle: vehicle.name, reason: keep.reason }),
      subjectType: "assets",
      subjectId: vehicle.id,
      actorId: ctx.actorId,
    });
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

/** Checkouts of the guard's closed since a moment: Return's "checked in elsewhere". */
export function useCheckInsSince(contactId: string | null | undefined, since: string | null | undefined) {
  return useQuery<{ id: string; asset_id: string; time_in: string }>(
    `SELECT id, asset_id, time_in FROM asset_checkouts
      WHERE person_id = ? AND time_in IS NOT NULL AND time_in >= ?
      ORDER BY time_in`,
    [contactId ?? "", since ?? "9999"],
  );
}

/** Fleet Vehicles a user holds: what End of Shift asks about. */
export function useHeldVehicles(userId: string | undefined) {
  return useQuery<{ checkoutId: string; name: string; time_out: string; kept_after_shift: number | null }>(
    `SELECT co.id AS checkoutId, a.name, co.time_out, co.kept_after_shift
       FROM asset_checkouts co
       JOIN assets a ON a.id = co.asset_id
      WHERE co.time_in IS NULL AND a.is_fleet = 1
        AND co.person_id = (SELECT contact_id FROM users WHERE id = ?)
      ORDER BY co.time_out`,
    [userId ?? ""],
  );
}

/**
 * Everything compileVehicleUse() needs for one guard's Shift
 * (src/pages/reports/ShiftReportPage.spec.md § Vehicles): their checkouts
 * that could overlap the window, the continuation of any kept at its end
 * included, and the fuel records they logged in it.
 */
export function useShiftVehicleRecords(
  guardId: string | undefined,
  shift: { started_at: string; ended_at: string | null } | null,
) {
  // From the stored times, never from "now": an open shift's window ends at
  // the current moment, and a query argument that moves every render
  // resubscribes forever (CLAUDE.md § Learnings). An open shift reads to the
  // end of time; compileVehicleUse() applies the live window.
  const from = shift ? new Date(shift.started_at).toISOString() : "9999";
  const to = !shift ? "0000" : shift.ended_at ? new Date(Date.parse(shift.ended_at) + 60_000).toISOString() : "9999";
  const { data: guard } = useQuery<{ contact_id: string | null }>(
    "SELECT contact_id FROM users WHERE id = ?",
    [guardId ?? ""],
  );
  const contactId = guard[0]?.contact_id ?? null;
  const { data: checkouts } = useQuery<VehicleCheckout>(
    `SELECT co.*, a.name AS asset_name, a.has_meter, a.meter_type, a.meter_reading
       FROM asset_checkouts co
       JOIN assets a ON a.id = co.asset_id
      WHERE co.person_id = ? AND co.time_out <= ? AND (co.time_in IS NULL OR co.time_in >= ?)`,
    [contactId ?? "", to, from],
  );
  const { data: fuelLogs } = useQuery<VehicleFuelLog>(
    `SELECT f.*, a.name AS asset_name, a.has_meter, a.meter_type
       FROM asset_fuel_logs f
       JOIN assets a ON a.id = f.asset_id
      WHERE f.logged_by_id = ? AND f.timestamp >= ? AND f.timestamp <= ?`,
    [guardId ?? "", from, to],
  );
  // Status changes, standalone readings, and what was raised on a Fleet
  // Vehicle (ShiftReportPage.spec.md § Vehicles). Each joins assets on id and
  // reads the status name by a correlated subquery, never a join on a
  // non-id column (CLAUDE.md § Learnings).
  const { data: statusLogs } = useQuery<VehicleStatusLog>(
    `SELECT sl.id, sl.asset_id, a.name AS asset_name, sl.note, sl.timestamp, sl.logged_by_id,
            a.has_meter, a.meter_type,
            (SELECT st.name FROM asset_statuses st WHERE st.id = sl.status_id) AS status_name
       FROM asset_status_logs sl
       JOIN assets a ON a.id = sl.asset_id
      WHERE a.is_fleet = 1 AND sl.logged_by_id = ? AND sl.timestamp >= ? AND sl.timestamp <= ?`,
    [guardId ?? "", from, to],
  );
  const { data: readings } = useQuery<VehicleMeterReading>(
    `SELECT r.id, r.asset_id, a.name AS asset_name, r.value, r.timestamp, r.logged_by_id,
            a.has_meter, a.meter_type
       FROM asset_meter_readings r
       JOIN assets a ON a.id = r.asset_id
      WHERE a.is_fleet = 1 AND r.logged_by_id = ? AND r.timestamp >= ? AND r.timestamp <= ?`,
    [guardId ?? "", from, to],
  );
  const { data: raised } = useQuery<VehicleRaised>(
    `SELECT 'incident' AS kind, i.id, i.asset_id, a.name AS asset_name, i.title, i.created_at,
            i.author_id AS created_by_id, a.has_meter, a.meter_type
       FROM incidents i JOIN assets a ON a.id = i.asset_id
      WHERE a.is_fleet = 1 AND i.author_id = ? AND i.created_at >= ? AND i.created_at <= ?
     UNION ALL
     SELECT 'ticket' AS kind, t.id, t.asset_id, a.name AS asset_name, t.title, t.created_at,
            t.created_by_id, a.has_meter, a.meter_type
       FROM tickets t JOIN assets a ON a.id = t.asset_id
      WHERE a.is_fleet = 1 AND t.created_by_id = ? AND t.created_at >= ? AND t.created_at <= ?`,
    [guardId ?? "", from, to, guardId ?? "", from, to],
  );
  return { contactId, checkouts, fuelLogs, statusLogs, readings, raised };
}
