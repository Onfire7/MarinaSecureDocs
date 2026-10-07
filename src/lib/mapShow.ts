// What a map shows: two independent switches, anchors and labels (owner,
// 2026-10-07; it was one three-way choice the day before). The pure half -
// the store is pages/shared/mapShow.ts.
export interface MapShow {
  anchors: boolean;
  labels: boolean;
}

export const SHOW_BOTH: MapShow = { anchors: true, labels: true };

/** The stored setting, or both on. The first version stored the words
 *  "anchors", "labels" or "both"; they still read. Anything unreadable is
 *  both on: a map that shows everything is never the wrong default. */
export function parseMapShow(raw: string | null): MapShow {
  if (raw === "anchors") return { anchors: true, labels: false };
  if (raw === "labels") return { anchors: false, labels: true };
  if (raw === "both" || raw === null) return SHOW_BOTH;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return SHOW_BOTH;
    const o = v as Partial<MapShow>;
    return { anchors: o.anchors !== false, labels: o.labels !== false };
  } catch {
    return SHOW_BOTH;
  }
}
