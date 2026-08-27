import { useQuery } from "@powersync/react";
import { db, stamp } from "../lib/db";
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
 * Check a reservation in, and mark its target occupied.
 *
 * `early_checkin` records an arrival ahead of the booking rather than
 * rewriting `expected_checkin`, so the booking still says what was agreed and
 * the difference between the two stays visible.
 */
export async function checkInReservation(
  reservation: { id: string; expected_checkin: string | null },
  targetName: string,
  occupiedStatus: { id: string } | null,
  locationId: string | null,
  actorId: string | null,
): Promise<void> {
  const now = stamp();
  const early =
    reservation.expected_checkin && now < reservation.expected_checkin ? now : null;
  await transact(async (tx) => {
    await update(tx, "reservations", reservation.id, {
      status: "checked_in",
      actual_checkin: now,
      early_checkin: early,
    });
    if (locationId && occupiedStatus) {
      await update(tx, "locations", locationId, { status_id: occupiedStatus.id });
    }
    await recordActivity(tx, {
      eventType: "reservation.checked_in",
      summary: `Checked in at ${targetName}`,
      subjectType: "reservations",
      subjectId: reservation.id,
      actorId,
    });
  });
}

export async function checkOutReservation(
  reservation: { id: string; expected_checkout: string | null },
  targetName: string,
  postStatusId: string | null,
  locationId: string | null,
  actorId: string | null,
): Promise<void> {
  const now = stamp();
  const late =
    reservation.expected_checkout && now > reservation.expected_checkout ? now : null;
  await transact(async (tx) => {
    await update(tx, "reservations", reservation.id, {
      status: "checked_out",
      actual_checkout: now,
      late_checkout: late,
    });
    if (locationId && postStatusId) {
      await update(tx, "locations", locationId, { status_id: postStatusId });
    }
    await recordActivity(tx, {
      eventType: "reservation.checked_out",
      summary: `Checked out of ${targetName}`,
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
