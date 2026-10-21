// The Fleet Vehicle Item — the pure half
// (src/pages/checklists/ActiveChecklistPage.spec.md § Fleet Vehicle Item).
//
// What each mode reads as answered, what Edit may undo, which tiles a mode
// can act on, and what a Status Check writes. Kept free of the database so
// the item's rules are tested without one.
import { readingChange, type FleetGroup, type ReadingChange } from "./fleet";

export const FLEET_ITEM_MODES = ["take", "status", "return"] as const;
export type FleetItemMode = (typeof FLEET_ITEM_MODES)[number];

export interface FleetVehicleConfig {
  mode?: FleetItemMode;
}

/** A meter type's unit, as a catalog key; unset or unknown reads as hours, like meterUnit(). */
export function unitKey(meterType: string | null | undefined): "mileage" | "hours" | "gallons" {
  return meterType === "mileage" || meterType === "gallons" ? meterType : "hours";
}

/** A config with no mode, or one this build doesn't know, is Take. */
export function fleetItemMode(config: FleetVehicleConfig | null | undefined): FleetItemMode {
  const mode = config?.mode;
  return mode && (FLEET_ITEM_MODES as readonly string[]).includes(mode) ? mode : "take";
}

/** The label a new item of this mode starts with: `checklists` namespace. */
export function fleetDefaultLabelKey(mode: FleetItemMode): string {
  return `fleet.defaultLabel.${mode}`;
}

/**
 * What a Fleet Vehicle Item records. Take and Return name the checkout they
 * made or found; a Status Check names the rows it wrote and the reading it
 * replaced, so Edit can withdraw exactly those.
 */
export type FleetVehicleResult =
  | { type: "fleet_vehicle"; mode: "take" | "status"; none: true }
  | { type: "fleet_vehicle"; mode: "take"; checkoutId: string; assetId: string }
  | { type: "fleet_vehicle"; mode: "return"; checkoutId: string; assetId: string }
  | { type: "fleet_vehicle"; mode: "return"; nothing: true }
  | {
      type: "fleet_vehicle";
      mode: "status";
      assetId: string;
      odometer: number | null;
      fuelLevel: number;
      fill?: { gallons: number; cost: number | null };
      fuelLogId: string;
      meterReadingId: string | null;
      previousReading: number | null;
    };

/** An open checkout the guard holds. */
export interface HeldCheckout {
  id: string;
  asset_id: string;
  time_out: string;
  kept_after_shift: number | boolean | null;
}

/** A checkout of the guard's closed during this Shift. */
export interface ShiftCheckIn {
  id: string;
  asset_id: string;
  time_in: string;
}

/**
 * Saved: the guard answered it. Circumstance: the world answered it — shown
 * and counted as answered, and written when the checklist is submitted.
 */
export type FleetAnswer =
  | { source: "saved" | "circumstance"; result: FleetVehicleResult }
  | null;

const byTimeOut = (a: HeldCheckout, b: HeldCheckout) => Date.parse(a.time_out) - Date.parse(b.time_out);

export function takeAnswer(saved: FleetVehicleResult | null, held: HeldCheckout[]): FleetAnswer {
  if (saved) return { source: "saved", result: saved };
  const first = [...held].sort(byTimeOut)[0];
  if (!first) return null;
  return {
    source: "circumstance",
    result: { type: "fleet_vehicle", mode: "take", checkoutId: first.id, assetId: first.asset_id },
  };
}

/** The vehicle Return asks about next: the one taken earliest. */
export function returnTarget(held: HeldCheckout[]): HeldCheckout | null {
  return [...held].sort(byTimeOut)[0] ?? null;
}

/**
 * Unanswered while anything is held: with two vehicles out, checking one in
 * leaves the item asking about the other.
 */
export function returnAnswer(
  saved: FleetVehicleResult | null,
  held: HeldCheckout[],
  checkInsThisShift: ShiftCheckIn[],
): FleetAnswer {
  if (held.length > 0) return null;
  if (saved) return { source: "saved", result: saved };
  const latest = [...checkInsThisShift].sort((a, b) => Date.parse(b.time_in) - Date.parse(a.time_in))[0];
  return {
    source: "circumstance",
    result: latest
      ? { type: "fleet_vehicle", mode: "return", checkoutId: latest.id, assetId: latest.asset_id }
      : { type: "fleet_vehicle", mode: "return", nothing: true },
  };
}

/** Why a checkout can't be undone: key under `checklists:fleet.undoBlocked`. */
export type UndoBlocked = "returnFirst" | "checkedOutAgain";

/**
 * A checkout can be undone only while it is still open. One the Return item
 * checked in is undone there first; one checked in anywhere else is history.
 */
export function undoCheckoutBlocked(input: {
  checkoutId: string;
  checkoutOpen: boolean;
  returnSaved: FleetVehicleResult | null;
}): UndoBlocked | null {
  return input.checkoutOpen ? null : "returnFirst";
}

/** A check-in can be undone only while nobody has taken the vehicle since. */
export function undoCheckinBlocked(input: { vehicleHasOpenCheckout: boolean }): UndoBlocked | null {
  return input.vehicleHasOpenCheckout ? "checkedOutAgain" : null;
}

/**
 * The reading to put back when a Status Check is withdrawn: its predecessor,
 * but only if the vehicle still shows this check's. A later reading stands.
 */
export function statusUndoReading(
  currentReading: number | null,
  result: FleetVehicleResult,
): { restore: number | null } {
  if (!("fuelLogId" in result) || !result.meterReadingId) return { restore: null };
  return currentReading === result.odometer ? { restore: result.previousReading } : { restore: null };
}

/** Which board tiles a mode can act on. Return never shows the board. */
export function pickable(mode: FleetItemMode, group: FleetGroup): boolean {
  return mode !== "return" && group === "available";
}

export interface StatusCheckInput {
  odometer: number | null;
  correctionReason: string | null;
  fuelLevel: number;
  fill: { gallons: number; cost: number | null } | null;
}

/**
 * What a Status Check writes: always one fuel row with the level (and the
 * fill-up, if there was one); a Meter Reading only if the odometer moved.
 */
export function statusCheckWrites(
  vehicle: { has_meter: number; meter_reading: number | null },
  input: StatusCheckInput,
): {
  reading: ReadingChange;
  fuelLog: { level: number; gallons: number | null; cost: number | null; odometer: number | null };
} {
  const odometer = vehicle.has_meter === 1 ? input.odometer : null;
  const reading = vehicle.has_meter === 1 ? readingChange(vehicle.meter_reading, odometer) : "none";
  if (reading === "correction" && !input.correctionReason?.trim()) {
    throw new Error("A lower odometer reading needs a reason.");
  }
  return {
    reading,
    fuelLog: {
      level: input.fuelLevel,
      gallons: input.fill?.gallons ?? null,
      cost: input.fill?.cost ?? null,
      odometer,
    },
  };
}
