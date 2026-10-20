// Fleet card — the pure half (src/pages/home/FleetCard.spec.md).
//
// Which group a vehicle sits in, what its fuel gauge reads, how far this trip
// has gone, and whether an odometer entry is a reading at all. Kept free of
// the database so the card's rules are tested without one.
import { compareNames, statusKey } from "./locations";

export type FleetGroup = "yours" | "available" | "others" | "out_of_service";

const GROUP_ORDER: FleetGroup[] = ["yours", "available", "others", "out_of_service"];

export interface FleetVehicleLike {
  name: string;
  status_name: string | null;
  checkout_id: string | null;
  checkout_person_id: string | null;
}

/** The status the palette already shows in red. Matched by name, as every
 *  Asset Status is: the set is the marina's own. */
export function isOutOfService(statusName: string | null | undefined): boolean {
  return statusKey(statusName) === "out_of_service";
}

/**
 * Out of service wins over who holds it: the card offers nothing on such a
 * vehicle. "Yours" is by contact, so a vehicle someone else checked out to
 * you is yours, and a user with no contact has nothing that is.
 */
export function fleetGroup(v: FleetVehicleLike, myContactId: string | null): FleetGroup {
  if (isOutOfService(v.status_name)) return "out_of_service";
  if (!v.checkout_id) return "available";
  if (myContactId && v.checkout_person_id === myContactId) return "yours";
  return "others";
}

export function boardOrder<T extends FleetVehicleLike>(vehicles: T[], myContactId: string | null): T[] {
  const rank = (v: T) => GROUP_ORDER.indexOf(fleetGroup(v, myContactId));
  return [...vehicles].sort((a, b) => rank(a) - rank(b) || compareNames(a.name, b.name));
}

/** Quarters of a tank, 0–4. */
export const FUEL_STEPS = ["E", "¼", "½", "¾", "F"] as const;
export const FULL = FUEL_STEPS.length - 1;

/**
 * The most recent of the level recorded at a check-in and a fill-up, which
 * means full. No record of either is unknown, not empty.
 */
export function lastFuelLevel(
  lastCheckIn: { at: string; level: number } | null,
  lastFillAt: string | null,
): number | null {
  if (lastFillAt && (!lastCheckIn || Date.parse(lastFillAt) >= Date.parse(lastCheckIn.at))) {
    return FULL;
  }
  return lastCheckIn ? lastCheckIn.level : null;
}

/** Distance on the meter since check-out, when there's a meter to read. */
export function tripDistance(
  v: { has_meter: number; meter_reading: number | null },
  odometerOut: number | null,
): number | null {
  if (v.has_meter !== 1 || v.meter_reading == null || odometerOut == null) return null;
  return v.meter_reading - odometerOut;
}

export type ReadingChange = "none" | "record" | "correction";

/**
 * Every fleet dialog prefills the odometer, so leaving it alone must not write
 * a reading. A lower figure is a correction and needs a reason, as everywhere
 * else a meter is read.
 */
export function readingChange(current: number | null, entered: number | null): ReadingChange {
  if (entered == null || Number.isNaN(entered)) return "none";
  if (current == null) return "record";
  if (entered === current) return "none";
  return entered < current ? "correction" : "record";
}

/**
 * Who has it. A checkout names a Contact, and staff Contacts are rarely on the
 * device, so the user linked to that Contact comes first.
 */
export function holderName(
  personId: string | null,
  users: { name: string; contact_id: string | null }[],
  contactName: string | null,
): string {
  if (personId) {
    const user = users.find((u) => u.contact_id === personId);
    if (user) return user.name;
  }
  return contactName ?? "Checked out";
}
