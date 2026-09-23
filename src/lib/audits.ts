// Audit helpers — the pure decisions a Finding makes. docs/audits.md is the
// spec; src/lib/audits.test.ts the cases. Nothing here touches the database.
import { distanceMeters } from "./geo";

/**
 * Unexpected Occupancy is derived, never asked: occupied with nothing on
 * file, or vacant with a current Lease or checked-in Reservation.
 */
export function unexpectedOccupancy(f: {
  occupied: boolean;
  hasCurrentLease: boolean;
  hasActiveReservation: boolean;
}): boolean {
  const expected = f.hasCurrentLease || f.hasActiveReservation;
  return f.occupied !== expected;
}

export interface GpsDecision {
  /** Show the capture prompt at all. */
  prompt: boolean;
  /** The capture button is enabled (a fix exists and is accurate enough). */
  captureEnabled: boolean;
  reason: "missing" | "far" | "ok";
  distanceMeters: number | null;
  accuracyMeters: number | null;
}

/**
 * The GPS prompt appears only when the Location has no coordinates or the
 * device is farther from them than the marina's audit radius; capture is
 * refused when the device's own accuracy is worse than the marina's limit.
 * It never assumes the user is in the right place — that is the checkbox
 * on the form, not this function's job.
 */
export function gpsPrompt(args: {
  location: { lat: number; lng: number } | null;
  device: { lat: number; lng: number; accuracy: number } | null;
  radius: number;
  accuracyLimit: number;
}): GpsDecision {
  const { location, device, radius, accuracyLimit } = args;
  const accuracyMeters = device?.accuracy ?? null;
  const captureEnabled = device !== null && device.accuracy <= accuracyLimit;
  if (!location) {
    return { prompt: true, captureEnabled, reason: "missing", distanceMeters: null, accuracyMeters };
  }
  if (!device) {
    // Nothing to compare against; the pin may be fine. Don't nag.
    return { prompt: false, captureEnabled: false, reason: "ok", distanceMeters: null, accuracyMeters };
  }
  const d = distanceMeters(device.lat, device.lng, location.lat, location.lng);
  if (d > radius) {
    return { prompt: true, captureEnabled, reason: "far", distanceMeters: d, accuracyMeters };
  }
  return { prompt: false, captureEnabled, reason: "ok", distanceMeters: d, accuracyMeters };
}

/**
 * Suggestions for a Service or Amenity note: the distinct notes already in
 * use, most-used first, ties by name. Case-insensitive, first spelling wins.
 */
export function rankNoteSuggestions(notes: (string | null | undefined)[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const raw of notes) {
    const label = (raw ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.n++;
    else counts.set(key, { label, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map((x) => x.label);
}

/** Counts of everything that would make a Location's removal a retirement. */
export interface LocationHistory {
  tickets: number;
  notes: number;
  incidents: number;
  leases: number;
  reservations: number;
  checkpoints: number;
  children: number;
  /** Boats or vehicles ever recorded there. */
  occupants: number;
  /** Findings from earlier Audits. */
  findings: number;
}

/** A Location with no history was created in error; anything else is retired. */
export function retireOrDelete(history: LocationHistory): "retire" | "delete" {
  return Object.values(history).some((n) => n > 0) ? "retire" : "delete";
}

export interface OrderableTarget {
  id: string;
  /** Position in the launch-time tree order. */
  treeIndex: number;
  lat: number | null;
  lng: number | null;
}

/**
 * Located targets first, nearest to the device; targets without coordinates
 * after, in tree order. With no device fix, everything is in tree order.
 */
export function orderTargets<T extends OrderableTarget>(
  targets: T[],
  device: { lat: number; lng: number } | null,
): T[] {
  if (!device) return [...targets].sort((a, b) => a.treeIndex - b.treeIndex);
  const dist = (t: T) =>
    t.lat === null || t.lng === null ? null : distanceMeters(device.lat, device.lng, t.lat, t.lng);
  return [...targets]
    .map((t) => ({ t, d: dist(t) }))
    .sort((a, b) => {
      if (a.d === null && b.d === null) return a.t.treeIndex - b.t.treeIndex;
      if (a.d === null) return 1;
      if (b.d === null) return -1;
      return a.d - b.d;
    })
    .map((x) => x.t);
}

export interface FieldUpdate {
  field: string;
  from: string | null;
  to: string;
}

/**
 * Search-as-you-type matched a record after the user had already typed into
 * other fields. Keep the record's values as the form's values, and turn each
 * typed value that the record lacks or contradicts into an *offered* update
 * — never discard what was typed, never apply it silently.
 */
export function mergeSearchMatch<K extends string>(
  typed: Record<K, string | null | undefined>,
  // NoInfer: the field set is the typed one; `id` on the record must not
  // widen K to include it.
  matched: { id: string } & NoInfer<Partial<Record<K, string | null | undefined>>>,
): { recordId: string; fields: Record<K, string | null>; updates: FieldUpdate[] } {
  const fields = {} as Record<K, string | null>;
  const updates: FieldUpdate[] = [];
  for (const key of Object.keys(typed) as K[]) {
    const have = matched[key] ?? null;
    const want = (typed[key] ?? "").trim();
    if (have === null && want !== "") {
      // The record lacks it: the typed value fills the gap outright.
      fields[key] = want;
      updates.push({ field: key, from: null, to: want });
    } else {
      fields[key] = have;
      if (want !== "" && have !== want) updates.push({ field: key, from: have, to: want });
    }
  }
  return { recordId: matched.id, fields, updates };
}

export interface CurrentService {
  serviceId: string;
  working: boolean;
  note: string | null;
}
export interface ObservedService {
  serviceId: string;
  present: boolean;
  working: boolean;
  note: string | null;
}

/**
 * Presence changes become Proposals (false negatives are common — a riser
 * under leaves). Working and note changes on a service that is already
 * present apply at once. Details observed on a service that isn't present
 * yet wait for the presence decision.
 */
export function servicePresenceDiff(
  current: CurrentService[],
  observed: ObservedService[],
): {
  proposals: { serviceId: string; present: boolean }[];
  immediate: { serviceId: string; working: boolean; note: string | null }[];
} {
  const have = new Map(current.map((c) => [c.serviceId, c]));
  const proposals: { serviceId: string; present: boolean }[] = [];
  const immediate: { serviceId: string; working: boolean; note: string | null }[] = [];
  for (const o of observed) {
    const cur = have.get(o.serviceId);
    if (o.present !== (cur !== undefined)) {
      proposals.push({ serviceId: o.serviceId, present: o.present });
      continue;
    }
    if (cur && (cur.working !== o.working || (cur.note ?? null) !== (o.note ?? null))) {
      immediate.push({ serviceId: o.serviceId, working: o.working, note: o.note ?? null });
    }
  }
  return { proposals, immediate };
}

export interface CurrentAttribute {
  attributeId: string;
  /** A `number` Attribute's value; null for a `choice` one. */
  value: number | null;
  /** A `choice` Attribute's value; null for a `number` one. */
  text: string | null;
  note: string | null;
}
export interface ObservedAttribute {
  attributeId: string;
  /** Both null means no value entered — an Attribute is always applicable
   *  to a valid type, never toggled on or off; only its value is optional. */
  value: number | null;
  text: string | null;
  note: string | null;
}

/**
 * Every change is a Proposal, including clearing a value that was set —
 * what a Location will accept (maximum boat length, back-in or
 * pull-through) is worth a second look every time it moves, not just when
 * it's first entered.
 */
export function attributeDiff(
  current: CurrentAttribute[],
  observed: ObservedAttribute[],
): {
  proposals: { attributeId: string; value: number | null; text: string | null; note: string | null }[];
} {
  const have = new Map(current.map((c) => [c.attributeId, c]));
  const proposals: { attributeId: string; value: number | null; text: string | null; note: string | null }[] = [];
  for (const o of observed) {
    const cur = have.get(o.attributeId);
    if (
      (cur?.value ?? null) !== o.value ||
      (cur?.text ?? null) !== (o.text ?? null) ||
      (cur?.note ?? null) !== (o.note ?? null)
    ) {
      proposals.push({ attributeId: o.attributeId, value: o.value, text: o.text ?? null, note: o.note ?? null });
    }
  }
  return { proposals };
}
