import { useQuery } from "@powersync/react";
import { db } from "../lib/db";
import { insert, transact, update } from "./sql";
import { recordActivity } from "./activity";
import type { ReservationTargetColumns } from "../lib/reservations";

// Reservations — bookings against a location or an asset.
//
// Occupancy-scoped by is_current, so a device holds what is booked now plus the
// trailing window. The target is one of two columns, and both carry the same
// three facts under different names — the SELECT below reconciles them so every
// view can treat "the target" as one thing.

export interface ReservationRow extends ReservationTargetColumns {
  id: string;
  status: string;
  contact_id: string | null;
  billing_type: string | null;
  expected_checkin: string | null;
  expected_checkout: string | null;
  actual_checkin: string | null;
  actual_checkout: string | null;
  early_checkin: string | null;
  late_checkout: string | null;
  rate: number | null;
  deposit: number | null;
  balance: number | null;
  is_current: number;
  contact_name: string | null;
  contact_phone: string | null;
}

const RESERVATION_SELECT = `
  SELECT r.*,
         c.name AS contact_name,
         cd.phone AS contact_phone,
         l.name AS location_name,
         lt.name AS location_type_name,
         l.reservation_visibility AS location_visibility,
         lps.name AS post_reservation_status_name,
         a.name AS asset_name,
         a.category AS asset_category,
         a.reservation_visibility AS asset_visibility,
         aps.name AS post_return_status_name
    FROM reservations r
    LEFT JOIN contacts c ON c.id = r.contact_id
    LEFT JOIN contact_details cd ON cd.contact_id = c.id
    LEFT JOIN locations l ON l.id = r.location_id
    LEFT JOIN location_types lt ON lt.id = l.location_type_id
    LEFT JOIN location_statuses lps ON lps.id = l.post_reservation_status_id
    LEFT JOIN assets a ON a.id = r.asset_id
    LEFT JOIN asset_statuses aps ON aps.id = a.post_return_status_id`;

export function useReservations() {
  return useQuery<ReservationRow>(
    `${RESERVATION_SELECT} ORDER BY r.expected_checkin`,
  );
}

export function useReservation(reservationId: string | undefined) {
  const { data, isLoading } = useQuery<ReservationRow>(
    `${RESERVATION_SELECT} WHERE r.id = ?`,
    [reservationId ?? ""],
  );
  return { reservation: data[0] ?? null, isLoading };
}

export function useReservationsForTarget(
  kind: "location" | "asset",
  targetId: string | undefined,
) {
  const column = kind === "location" ? "location_id" : "asset_id";
  return useQuery<ReservationRow>(
    `${RESERVATION_SELECT} WHERE r.${column} = ? ORDER BY r.expected_checkin`,
    [targetId ?? ""],
  );
}

export function useReservationsForContact(contactId: string | undefined) {
  return useQuery<ReservationRow>(
    `${RESERVATION_SELECT} WHERE r.contact_id = ? ORDER BY r.expected_checkin DESC`,
    [contactId ?? ""],
  );
}

export interface ReservationInput {
  status: string;
  contactId: string | null;
  locationId?: string | null;
  assetId?: string | null;
  billingType?: string | null;
  expectedCheckin: string | null;
  expectedCheckout: string | null;
  rate?: number | null;
  deposit?: number | null;
  balance?: number | null;
}

function reservationColumns(input: Partial<ReservationInput>) {
  return {
    status: input.status,
    contact_id: input.contactId === undefined ? undefined : input.contactId,
    location_id: input.locationId === undefined ? undefined : input.locationId,
    asset_id: input.assetId === undefined ? undefined : input.assetId,
    billing_type: input.billingType === undefined ? undefined : input.billingType,
    expected_checkin:
      input.expectedCheckin === undefined ? undefined : input.expectedCheckin,
    expected_checkout:
      input.expectedCheckout === undefined ? undefined : input.expectedCheckout,
    rate: input.rate === undefined ? undefined : input.rate,
    deposit: input.deposit === undefined ? undefined : input.deposit,
    balance: input.balance === undefined ? undefined : input.balance,
  };
}

/**
 * The reservation this booking would collide with, if any.
 *
 * Read at submit time rather than from the rendered list, because the list may
 * be minutes old and the conflicting booking may have arrived since. It is a
 * guard, not a constraint: two devices offline in the same dead zone can still
 * both book the same slip, and the marina reconciles that when they sync.
 * MarinaSettings.allowOverlappingReservations turns it off entirely.
 */
export async function findConflict(
  kind: "location" | "asset",
  targetId: string,
  start: number,
  end: number,
): Promise<ReservationRow | null> {
  const column = kind === "location" ? "location_id" : "asset_id";
  const candidates = await db.getAll<ReservationRow>(
    `${RESERVATION_SELECT}
      WHERE r.${column} = ?
        AND r.status IN ('requested', 'confirmed', 'checked_in')`,
    [targetId],
  );
  return (
    candidates.find((r) => {
      if (!r.expected_checkin) return false;
      const rs = new Date(r.expected_checkin).getTime();
      const re = r.expected_checkout
        ? new Date(r.expected_checkout).getTime()
        : rs + 24 * 3600_000;
      return start < re && rs < end;
    }) ?? null
  );
}

export async function createReservation(
  input: ReservationInput,
  targetName: string,
  actorId: string | null,
): Promise<string> {
  return transact(async (tx) => {
    const reservationId = await insert(
      tx,
      "reservations",
      reservationColumns(input),
    );
    await recordActivity(tx, {
      eventType: "reservation.created",
      summary: `Reservation created on ${targetName}`,
      subjectType: "reservations",
      subjectId: reservationId,
      actorId,
    });
    return reservationId;
  });
}

export async function saveReservation(
  reservationId: string,
  input: Partial<ReservationInput>,
): Promise<void> {
  await update(db, "reservations", reservationId, reservationColumns(input));
}

/**
 * Check a reservation in or out, and move its target's status with it.
 *
 * One function for both directions and both target kinds, because they differ
 * only in which columns get the timestamp and which status the target lands
 * on — and doing them separately is how a check-in ends up recorded with the
 * slip still reading vacant.
 *
 * A location's status is a column; an asset's is the newest row in its status
 * log. Both are written here, in the reservation's own transaction, so a device
 * that goes flat cannot leave one without the other.
 *
 * early_checkin / late_checkout record an arrival or departure outside the
 * booked window rather than rewriting it: the booking still says what was
 * agreed, and the difference stays visible for billing.
 */
export async function checkReservation(opts: {
  reservation: ReservationRow;
  mode: "in" | "out";
  at: Date;
  targetKind: "location" | "asset";
  targetId: string;
  targetName: string;
  /** The status the target takes on. Null leaves it unchanged. */
  status: { id: string; name: string } | null;
  guestName: string;
  actorId: string | null;
}): Promise<void> {
  const { reservation, mode, at, targetKind, targetId, status, actorId } = opts;
  const ts = at.toISOString();
  const expected =
    mode === "in" ? reservation.expected_checkin : reservation.expected_checkout;
  const outsideWindow =
    expected != null && (mode === "in" ? ts < expected : ts > expected);

  await transact(async (tx) => {
    await update(tx, "reservations", reservation.id, {
      status: mode === "in" ? "checked_in" : "checked_out",
      actual_checkin: mode === "in" ? ts : undefined,
      actual_checkout: mode === "out" ? ts : undefined,
      early_checkin: mode === "in" && outsideWindow ? ts : undefined,
      late_checkout: mode === "out" && outsideWindow ? ts : undefined,
    });

    if (status) {
      if (targetKind === "location") {
        await update(tx, "locations", targetId, { status_id: status.id });
      } else {
        await insert(tx, "asset_status_logs", {
          asset_id: targetId,
          status_id: status.id,
          note: mode === "in" ? "Reservation check-in" : "Reservation check-out",
          timestamp: ts,
          logged_by_id: actorId,
        });
      }
    }

    await recordActivity(tx, {
      eventType:
        mode === "in" ? "reservation.checked_in" : "reservation.checked_out",
      summary:
        mode === "in"
          ? `${opts.guestName} checked in to ${opts.targetName}`
          : `${opts.guestName} checked out of ${opts.targetName}`,
      subjectType: "reservations",
      subjectId: reservation.id,
      actorId,
    });
  });
}

export async function setReservationStatus(
  reservationId: string,
  status: string,
  targetName: string,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "reservations", reservationId, { status });
    await recordActivity(tx, {
      eventType: "reservation.status_changed",
      summary: `Reservation on ${targetName} set to ${status.replace(/_/g, " ")}`,
      subjectType: "reservations",
      subjectId: reservationId,
      actorId,
    });
  });
}
