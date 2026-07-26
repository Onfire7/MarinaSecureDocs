// Locations — shared display helpers (see pages/location-list.html).
// Location.status is an open set: the four standard values plus any
// admin-defined additions, which fall through to the neutral badge.

export const STANDARD_STATUSES = [
  "occupied",
  "vacant",
  "reserved",
  "out_of_service",
  "needs_cleaning",
] as const;

// The status a reservation-enabled Location takes on check-out when no
// per-location override is set (see docs: data-model.html — Location).
export const DEFAULT_POST_RESERVATION_STATUS = "needs_cleaning";

// Status is absent entirely for types that don't track it (containers, roots).
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "occupied":
      return "badge badge-bad";
    case "vacant":
      return "badge badge-good";
    case "reserved":
      return "badge badge-accent";
    case "out_of_service":
    case "needs_cleaning":
      return "badge badge-warn";
    default:
      return "badge";
  }
}

// Rect/pin fill colors for the two map modes, keyed to the same semantics
// as the status badges.
export function statusMapColors(status: string | null | undefined): {
  background: string;
  border: string;
} {
  switch (status) {
    case "occupied":
      return { background: "var(--bad-bg)", border: "var(--bad)" };
    case "vacant":
      return { background: "var(--good-bg)", border: "var(--good)" };
    case "reserved":
      return { background: "var(--accent-soft)", border: "var(--accent)" };
    case "out_of_service":
    case "needs_cleaning":
      return { background: "var(--warn-bg)", border: "var(--warn)" };
    default:
      return { background: "var(--fill)", border: "var(--line)" };
  }
}

// "Slip 9" before "Slip 14".
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// Walk the parent chain via an id→record map (the list pages already
// subscribe to every location, so the chain is resolvable client-side).
export function breadcrumb(
  locationId: string | undefined,
  byId: Map<string, { name: string; parent?: { id: string } | null }>,
): string[] {
  const parts: string[] = [];
  let cursor = locationId ? byId.get(locationId) : undefined;
  let guard = 0;
  while (cursor && guard++ < 20) {
    parts.unshift(cursor.name);
    cursor = cursor.parent?.id ? byId.get(cursor.parent.id) : undefined;
  }
  return parts;
}
