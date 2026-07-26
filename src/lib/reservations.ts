// Reservations — shared display + target helpers (see docs:
// pages/reservation-list.html). A reservation's target is a Location or an
// Asset; this list doesn't care which beyond the type label.

export const RESERVATION_STATUSES = [
  "requested",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
] as const;

export function reservationStatusBadgeClass(status: string): string {
  switch (status) {
    case "checked_in":
      return "badge badge-bad"; // target is occupied right now
    case "confirmed":
      return "badge badge-accent";
    case "requested":
      return "badge badge-warn";
    case "checked_out":
      return "badge badge-good";
    default:
      return "badge";
  }
}

export interface ReservationTarget {
  kind: "location" | "asset";
  id: string;
  name: string;
  typeLabel: string;
  /** Target default for new bookings: public visibility defaults to Billable. */
  defaultBillable: boolean;
  postStatus?: string | null;
}

// A reservation's own billingType governs its billing fields; rows created
// before the field existed fall back to the target's default.
export function isBillable(
  r: { billingType?: string | null },
  target: ReservationTarget | null,
): boolean {
  if (r.billingType) return r.billingType === "billable";
  return target?.defaultBillable ?? false;
}

type ReservationWithTargets = {
  location?: {
    id: string;
    name: string;
    reservationVisibility?: string | null;
    postReservationStatus?: string | null;
    type?: { name: string } | null;
  } | null;
  asset?: {
    id: string;
    name: string;
    category?: string | null;
    reservationVisibility?: string | null;
    postReturnStatus?: string | null;
  } | null;
};

export function reservationTargetOf(
  r: ReservationWithTargets,
): ReservationTarget | null {
  if (r.location) {
    return {
      kind: "location",
      id: r.location.id,
      name: r.location.name,
      typeLabel: r.location.type?.name ?? "Location",
      defaultBillable: r.location.reservationVisibility === "public",
      postStatus: r.location.postReservationStatus,
    };
  }
  if (r.asset) {
    return {
      kind: "asset",
      id: r.asset.id,
      name: r.asset.name,
      typeLabel: r.asset.category ?? "Asset",
      defaultBillable: r.asset.reservationVisibility === "public",
      postStatus: r.asset.postReturnStatus,
    };
  }
  return null;
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
