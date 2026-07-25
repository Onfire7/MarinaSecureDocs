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
  /** Billing fields (rate/deposit/balance, early/late) show only when public. */
  isPublic: boolean;
  postStatus?: string | null;
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
      isPublic: r.location.reservationVisibility === "public",
      postStatus: r.location.postReservationStatus,
    };
  }
  if (r.asset) {
    return {
      kind: "asset",
      id: r.asset.id,
      name: r.asset.name,
      typeLabel: r.asset.category ?? "Asset",
      isPublic: r.asset.reservationVisibility === "public",
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
