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

// A reservation's own billing_type governs its billing fields; rows created
// before the field existed fall back to the target's default.
export function isBillable(
  r: { billing_type?: string | null },
  target: ReservationTarget | null,
): boolean {
  if (r.billing_type) return r.billing_type === "billable";
  return target?.defaultBillable ?? false;
}

/**
 * The columns a reservation query selects about its two possible targets.
 *
 * A reservation points at a location OR an asset — `num_nonnulls(...) = 1`
 * holds the "exactly one" down — and the two carry the same three facts under
 * different column names. Resolving that here rather than at each call site is
 * why every reservation view can treat its target as one thing.
 */
export interface ReservationTargetColumns {
  location_id?: string | null;
  location_name?: string | null;
  location_type_name?: string | null;
  location_visibility?: string | null;
  post_reservation_status_name?: string | null;
  asset_id?: string | null;
  asset_name?: string | null;
  asset_category?: string | null;
  asset_visibility?: string | null;
  post_return_status_name?: string | null;
}

export function reservationTargetOf(
  r: ReservationTargetColumns,
): ReservationTarget | null {
  if (r.location_id) {
    return {
      kind: "location",
      id: r.location_id,
      name: r.location_name ?? "Location",
      typeLabel: r.location_type_name ?? "Location",
      defaultBillable: r.location_visibility === "public",
      postStatus: r.post_reservation_status_name,
    };
  }
  if (r.asset_id) {
    return {
      kind: "asset",
      id: r.asset_id,
      name: r.asset_name ?? "Asset",
      typeLabel: r.asset_category ?? "Asset",
      defaultBillable: r.asset_visibility === "public",
      postStatus: r.post_return_status_name,
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
