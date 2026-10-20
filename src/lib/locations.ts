// Locations — shared display helpers (see pages/location-list.html).
//
// A location's status is an admin-defined row in `location_statuses`, not a
// fixed enum: the four standard ones plus whatever a marina adds. So its
// display name is whatever the row says, and only the *colour* needs a rule.
// statusKey() normalises the name back to a key the standard set can be
// recognised by; anything a marina invents falls through to the neutral badge,
// which is the open-set behaviour this was always specified to have.

export const STANDARD_STATUSES = [
  "occupied",
  "vacant",
  "reserved",
  "out_of_service",
  "needs_cleaning",
] as const;

/** "Out of Service" → "out_of_service". */
export function statusKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

// Title-cases an enum value — priorities, reservation statuses, item types.
// NOT for the lookup-table statuses, whose rows already carry a display name.
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function statusBadgeClass(status: string | null | undefined): string {
  switch (statusKey(status)) {
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

// Rect/pin fill + text colors for the two map modes, keyed to the same
// semantics as the status badges — and, deliberately, to the very same CSS
// custom properties the badges use (var(--good) on var(--good-bg), etc.),
// so a status rectangle's contrast is guaranteed by the same light/dark
// palette pairing that already keeps badges readable in both themes,
// rather than a second contrast decision to keep in sync.
export function statusMapColors(status: string | null | undefined): {
  background: string;
  border: string;
  text: string;
} {
  switch (statusKey(status)) {
    case "occupied":
      return { background: "var(--bad-bg)", border: "var(--bad)", text: "var(--bad)" };
    case "vacant":
      return { background: "var(--good-bg)", border: "var(--good)", text: "var(--good)" };
    case "reserved":
      return { background: "var(--accent-soft)", border: "var(--accent)", text: "var(--accent)" };
    case "out_of_service":
    case "needs_cleaning":
      return { background: "var(--warn-bg)", border: "var(--warn)", text: "var(--warn)" };
    default:
      return { background: "var(--fill)", border: "var(--line)", text: "var(--ink)" };
  }
}

// ---------------------------------------------------------------- Map placements

// Mirrors location_map_placements.placement. cx/cy
// are the one part of this that's genuinely relative (percent of the map
// image); everything about the rectangle's own size is intrinsic to its
// label instead, so a rotated label rotates a normally-proportioned box
// rather than stretching two independently-percent axes against each other.
/** A point on a map, in percent of the image: x to the right, y down. */
export interface MapPoint {
  cx: number;
  cy: number;
}

/** A label on a map (docs/maps.md): its own centre, rotation and size.
 *  Independent of the anchor it names - moving the anchor leaves the label
 *  where it was (owner, 2026-10-05). */
export interface LabelShape extends MapPoint {
  rotation: number;
  fontSize?: number;
  paddingX?: number;
  paddingY?: number;
  /** A traced polygon, shaded in the status colour, drawn with or instead
   *  of the text (lib/outline.ts; owner, 2026-10-07). */
  outline?: [number, number][] | null;
  /** Draw the text. Off only when there is an outline to draw instead. */
  showText?: boolean;
}

export const DEFAULT_PLACEMENT_STYLE = {
  fontSize: 12,
  paddingX: 8,
  paddingY: 4,
} as const;

/** The size a label is laid out at before being scaled to its stored size.
 *  A dense map stores labels at 4px, and a phone browser paints text that
 *  small larger than it lays it out - the name spilled out of the top-left
 *  of its box on the owner's phone twice (2026-10-04, 2026-10-05), and the
 *  text-size opt-out did not stop it. Laid out at a readable size and
 *  scaled down with a transform, paint and layout cannot disagree. */
export const LABEL_LAYOUT_PX = 12;

/** CSS for an intrinsically-sized, rotated map-rect label — shared by the editor and every viewer. */
export function placementStyle(p: LabelShape): {
  left: string;
  top: string;
  fontSize: string;
  padding: string;
  maxWidth: string;
  transform: string;
} {
  const fontSize = p.fontSize ?? DEFAULT_PLACEMENT_STYLE.fontSize;
  const paddingX = p.paddingX ?? DEFAULT_PLACEMENT_STYLE.paddingX;
  const paddingY = p.paddingY ?? DEFAULT_PLACEMENT_STYLE.paddingY;
  // Small labels are laid out at LABEL_LAYOUT_PX and scaled down; a label
  // already that size or larger is laid out as it is.
  const base = Math.max(LABEL_LAYOUT_PX, fontSize);
  const k = fontSize / base;
  const r = 1 / k;
  return {
    left: `${p.cx}%`,
    top: `${p.cy}%`,
    fontSize: `${base}px`,
    padding: `${paddingY * r}px ${paddingX * r}px`,
    maxWidth: `${220 * r}px`,
    transform: `translate(-50%, -50%) rotate(${p.rotation ?? 0}deg) scale(${k})`,
  };
}

// "Slip 9" before "Slip 14".
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** The map a page showing one map at a time opens on (docs/maps.md § A
 *  location on several maps). Of the maps it is on: the one scoped to its
 *  nearest ancestor, else the first by name. On none: its nearest
 *  ancestor's map, else the overview (a map whose scope has no parent). */
export function defaultMapFor(
  locationId: string | null | undefined,
  input: {
    locations: { id: string; parent_id: string | null }[];
    maps: { id: string; name: string; scope_id: string | null; scope_name?: string | null; scope_parent_id: string | null }[];
    onMapIds: string[];
  },
): string | null {
  const { locations, maps, onMapIds } = input;
  const parentOf = new Map(locations.map((l) => [l.id, l.parent_id]));
  // Ancestors nearest first.
  const chain: string[] = [];
  let cursor = locationId ? (parentOf.get(locationId) ?? null) : null;
  while (cursor && chain.length < 32 && !chain.includes(cursor)) {
    chain.push(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  const byName = (a: { name: string; scope_name?: string | null }, b: { name: string; scope_name?: string | null }) =>
    compareNames(a.scope_name ?? a.name, b.scope_name ?? b.name);
  const on = maps.filter((m) => onMapIds.includes(m.id));
  if (on.length > 0) {
    const rank = (m: { scope_id: string | null }) => {
      const i = m.scope_id ? chain.indexOf(m.scope_id) : -1;
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...on].sort((a, b) => rank(a) - rank(b) || byName(a, b))[0].id;
  }
  for (const id of chain) {
    const m = maps.filter((x) => x.scope_id === id).sort(byName)[0];
    if (m) return m.id;
  }
  return [...maps].filter((m) => !m.scope_parent_id).sort(byName)[0]?.id ?? null;
}

// Walk the parent chain via an id→record map (the list pages already
// subscribe to every location, so the chain is resolvable client-side).
export function breadcrumb(
  locationId: string | undefined,
  byId: Map<string, { name: string; parent_id?: string | null }>,
): string[] {
  const parts: string[] = [];
  let cursor = locationId ? byId.get(locationId) : undefined;
  let guard = 0;
  while (cursor && guard++ < 20) {
    parts.unshift(cursor.name);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return parts;
}
