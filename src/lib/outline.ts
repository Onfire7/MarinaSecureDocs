// A location's outline on a map (docs/maps.md): a polygon traced over a
// pre-labelled map image, shaded in the location's status colour, drawn
// instead of - or as well as - its text label (owner, 2026-10-07). Points
// are [x, y] in percent of the image, x to the right and y down, like
// every other map coordinate. Pure: no DOM, no database.

export type OutlinePoint = [number, number];

const round = (n: number) => +n.toFixed(2);
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Twice the signed area (shoelace). Zero for a shape with no inside. */
function area2(points: OutlinePoint[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

/** An outline fit to store, or null when what was traced is not a shape:
 *  each point clamped to the image and rounded, repeated corners dropped
 *  (including a last corner tapped on top of the first), at least three
 *  corners, and some area inside them. */
export function cleanOutline(raw: readonly (readonly number[])[] | null | undefined): OutlinePoint[] | null {
  if (!raw) return null;
  const out: OutlinePoint[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q: OutlinePoint = [round(clamp(p[0])), round(clamp(p[1]))];
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev[0] - q[0], prev[1] - q[1]) < 0.05) continue;
    out.push(q);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  if (out.length < 3) return null;
  if (Math.abs(area2(out)) < 0.01) return null;
  return out;
}

/** Is a point inside the outline? Ray casting; a point on an edge may
 *  answer either way, which is fine for where a card points. */
export function insideOutline(points: OutlinePoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A point inside the outline to centre things on - the editor's first
 *  view, where a selection card points. The centroid when it is inside; for
 *  a shape like an L, whose centroid falls outside, the middle of the widest
 *  stretch of the horizontal line through it. */
export function outlineCentre(points: OutlinePoint[]): { x: number; y: number } {
  const a = area2(points);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  const centroid = a === 0 ? { x: points[0][0], y: points[0][1] } : { x: cx / (3 * a), y: cy / (3 * a) };
  if (insideOutline(points, centroid.x, centroid.y)) return { x: round(centroid.x), y: round(centroid.y) };
  // Scan across: crossings of the line y = centroid.y, paired into the
  // stretches that lie inside, the widest wins. Nudge off a vertex.
  const y = centroid.y + 1e-6;
  const xs: number[] = [];
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((p, q) => p - q);
  let best = { x: centroid.x, w: -1 };
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const w = xs[k + 1] - xs[k];
    if (w > best.w) best = { x: (xs[k] + xs[k + 1]) / 2, w };
  }
  return { x: round(best.x), y: round(centroid.y) };
}

/** An outline as an SVG `points` attribute. */
export function outlinePoints(points: OutlinePoint[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

/** An outline as stored on the device - jsonb arrives as text. */
export function parseOutline(raw: string | null | undefined): OutlinePoint[] | null {
  if (!raw) return null;
  try {
    return cleanOutline(JSON.parse(raw) as number[][]);
  } catch {
    return null;
  }
}
