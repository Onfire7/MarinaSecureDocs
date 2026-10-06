// Where a GPS position is on a marina map, and the reverse (docs/maps.md).
//
// A marina map is a drawing, not a projection: a dock drawn too long, a loop
// road drawn too tight, the whole thing at an angle. A single affine fit
// would be right on average and wrong at the far end of the long dock, and
// nobody would know. So the fit is PIECEWISE (owner, 2026-10-04): the
// control points are triangulated, each triangle carries its own mapping,
// and every region of the map keeps its own scale and rotation.
//
// A control point is a location that is both anchored on the map (its
// placement's cx, cy) and pinned (gps_lat, gps_lng). Every audit that
// captures a fix and taps the map adds one.
//
//   · fewer than three usable points, or three in a line, is NO fit - not a
//     bad one;
//   · inside the calibrated area a position is interpolated across the
//     triangle it falls in; outside, the nearest triangle extrapolates and
//     the result says `inside: false`;
//   · quality is leave-one-out: each point is dropped, the fit rebuilt and
//     the error at that point measured in metres, which names a wrong pin
//     rather than averaging it away. A point on the hull cannot be
//     interpolated by the rest, and a straight-line extrapolation through
//     one wrong neighbour inherits that neighbour's whole error - so a
//     dropped point that falls outside the reduced hull is predicted by
//     the reduced set's affine fit instead, which a single bad pin only
//     nudges.
//
// Pure: nothing here touches the database or the DOM.
import { distanceMeters } from "./geo";

export interface ControlPoint {
  /** Percent of the map image, x to the right and y DOWN. */
  cx: number;
  cy: number;
  lat: number;
  lng: number;
  /** What to call it in a residual report. */
  label?: string;
  /** From an undecided audit Proposal rather than a saved anchor: counts
   *  now, named as such in the report (owner, 2026-10-05). */
  provisional?: boolean;
}

export interface MapPoint {
  cx: number;
  cy: number;
  /** False when the position lies outside the calibrated area and the
   *  nearest triangle was extrapolated. */
  inside: boolean;
}

export interface GpsPoint {
  lat: number;
  lng: number;
  inside: boolean;
}

export interface Residual {
  point: ControlPoint;
  /** Metres between where the point is pinned and where the fit built
   *  without it would put it. */
  errorMeters: number;
}

export interface MapFit {
  points: ControlPoint[];
  triangles: [number, number, number][];
  toMap(lat: number, lng: number): MapPoint;
  toGps(cx: number, cy: number): GpsPoint;
  /** A circle of `meters` radius around a position, as half-widths in
   *  percent of the map - an ellipse, since a map's axes rarely share a
   *  scale. */
  radiusAt(lat: number, lng: number, meters: number): { rx: number; ry: number };
  /** Leave-one-out error per point, worst first. */
  residuals(): Residual[];
}

interface XY {
  x: number;
  y: number;
}

/** Metres east and north of an origin, good to well under a metre across a
 *  marina. */
function projector(points: { lat: number; lng: number }[]) {
  const lat0 = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const lng0 = points.reduce((a, p) => a + p.lng, 0) / points.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_574;
  return {
    toXY: (lat: number, lng: number): XY => ({ x: (lng - lng0) * kx, y: (lat - lat0) * ky }),
    toLatLng: (p: XY) => ({ lat: lat0 + p.y / ky, lng: lng0 + p.x / kx }),
  };
}

/** Points closer than this are the same point: a slip pinned twice, or the
 *  same corner anchored from two audits. */
const MERGE_METERS = 0.5;
const MERGE_PERCENT = 0.2;

export function mergeControlPoints(points: ControlPoint[]): ControlPoint[] {
  const out: ControlPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.cx) || !Number.isFinite(p.cy) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const twin = out.find(
      (q) => distanceMeters(p.lat, p.lng, q.lat, q.lng) < MERGE_METERS || Math.hypot(p.cx - q.cx, p.cy - q.cy) < MERGE_PERCENT,
    );
    if (!twin) {
      out.push({ ...p });
      continue;
    }
    if (p.provisional) twin.provisional = true;
    // Average the twins rather than keep the first: neither is more right.
    twin.cx = (twin.cx + p.cx) / 2;
    twin.cy = (twin.cy + p.cy) / 2;
    twin.lat = (twin.lat + p.lat) / 2;
    twin.lng = (twin.lng + p.lng) / 2;
  }
  return out;
}

/** The control points a map has: every anchor that carries coordinates -
 *  a located anchor's are its location's, a free calibration point's are
 *  its own. An anchor without coordinates is a place with no fix yet and
 *  contributes nothing. A provisional anchor for a location supersedes the
 *  saved one: it is the newer word on where the location is. */
export function controlPointsFor(
  anchors: { cx: number; cy: number; lat: number | null; lng: number | null; label?: string | null; locationId?: string | null; provisional?: boolean }[],
): ControlPoint[] {
  const provisionalFor = new Set(anchors.filter((a) => a.provisional && a.locationId).map((a) => a.locationId));
  const out: ControlPoint[] = [];
  for (const a of anchors) {
    if (a.lat === null || a.lng === null) continue;
    if (!a.provisional && a.locationId && provisionalFor.has(a.locationId)) continue;
    out.push({ cx: a.cx, cy: a.cy, lat: a.lat, lng: a.lng, label: a.label ?? undefined, provisional: a.provisional || undefined });
  }
  return out;
}

export function buildMapFit(raw: ControlPoint[]): MapFit | null {
  const points = mergeControlPoints(raw);
  if (points.length < 3) return null;
  const proj = projector(points);
  const xy = points.map((p) => proj.toXY(p.lat, p.lng));
  const triangles = delaunay(xy);
  if (triangles.length === 0) return null;
  const map = points.map((p) => ({ x: p.cx, y: p.cy }));

  const locate = (space: XY[], q: XY) => {
    let best: { tri: [number, number, number]; bary: [number, number, number]; inside: boolean; dist: number } | null = null;
    for (const tri of triangles) {
      const bary = barycentric(space[tri[0]], space[tri[1]], space[tri[2]], q);
      if (!bary) continue;
      const inside = bary.every((b) => b >= -1e-9);
      if (inside) return { tri, bary, inside: true, dist: 0 };
      const dist = distanceToTriangle(space[tri[0]], space[tri[1]], space[tri[2]], q);
      if (!best || dist < best.dist) best = { tri, bary, inside: false, dist };
    }
    return best;
  };
  const apply = (space: XY[], hit: NonNullable<ReturnType<typeof locate>>): XY => {
    const [a, b, c] = hit.tri;
    const [la, lb, lc] = hit.bary;
    return { x: la * space[a].x + lb * space[b].x + lc * space[c].x, y: la * space[a].y + lb * space[b].y + lc * space[c].y };
  };

  const toMap = (lat: number, lng: number): MapPoint => {
    const hit = locate(xy, proj.toXY(lat, lng))!;
    const m = apply(map, hit);
    return { cx: m.x, cy: m.y, inside: hit.inside };
  };
  const toGps = (cx: number, cy: number): GpsPoint => {
    const hit = locate(map, { x: cx, y: cy })!;
    const g = proj.toLatLng(apply(xy, hit));
    return { lat: g.lat, lng: g.lng, inside: hit.inside };
  };
  const radiusAt = (lat: number, lng: number, meters: number) => {
    // Push a circle through the fit and take its bounding box: honest
    // about a map whose axes do not share a scale.
    const centre = proj.toXY(lat, lng);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      const g = proj.toLatLng({ x: centre.x + meters * Math.cos(a), y: centre.y + meters * Math.sin(a) });
      const m = toMap(g.lat, g.lng);
      minX = Math.min(minX, m.cx); maxX = Math.max(maxX, m.cx);
      minY = Math.min(minY, m.cy); maxY = Math.max(maxY, m.cy);
    }
    return { rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 };
  };
  const residuals = (): Residual[] => {
    const out: Residual[] = [];
    for (let i = 0; i < points.length; i++) {
      const without = buildMapFit(points.filter((_, j) => j !== i));
      const p = points[i];
      if (!without) {
        out.push({ point: p, errorMeters: Number.POSITIVE_INFINITY });
        continue;
      }
      let g = without.toGps(p.cx, p.cy);
      if (!g.inside) {
        const rest = points.filter((_, j) => j !== i);
        const restProj = projector(rest);
        const affine = affineFit(rest.map((q) => ({ x: q.cx, y: q.cy })), rest.map((q) => restProj.toXY(q.lat, q.lng)));
        if (affine) {
          const ll = restProj.toLatLng(affine({ x: p.cx, y: p.cy }));
          g = { ...ll, inside: false };
        }
      }
      out.push({ point: p, errorMeters: distanceMeters(p.lat, p.lng, g.lat, g.lng) });
    }
    return out.sort((a, b) => b.errorMeters - a.errorMeters);
  };

  return { points, triangles, toMap, toGps, radiusAt, residuals };
}

/** A single least-squares affine fit, for comparison and for the test that
 *  shows why the piecewise one exists. */
export function fitAffine(raw: ControlPoint[]): ((lat: number, lng: number) => { cx: number; cy: number }) | null {
  const points = mergeControlPoints(raw);
  if (points.length < 3) return null;
  const proj = projector(points);
  const f = affineFit(points.map((p) => proj.toXY(p.lat, p.lng)), points.map((p) => ({ x: p.cx, y: p.cy })));
  if (!f) return null;
  return (lat, lng) => {
    const m = f(proj.toXY(lat, lng));
    return { cx: m.x, cy: m.y };
  };
}

/** Least-squares affine map from one plane to another. */
function affineFit(from: XY[], to: XY[]): ((p: XY) => XY) | null {
  if (from.length < 3) return null;
  const rows = from.map((q) => [q.x, q.y, 1]);
  const ax = leastSquares(rows, to.map((t) => t.x));
  const ay = leastSquares(rows, to.map((t) => t.y));
  if (!ax || !ay) return null;
  return (p) => ({ x: ax[0] * p.x + ax[1] * p.y + ax[2], y: ay[0] * p.x + ay[1] * p.y + ay[2] });
}

// ── geometry ──────────────────────────────────────────────────────────────

function barycentric(a: XY, b: XY, c: XY, p: XY): [number, number, number] | null {
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-12) return null;
  const l1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
  const l2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
  return [l1, l2, 1 - l1 - l2];
}

function distanceToSegment(a: XY, b: XY, p: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToTriangle(a: XY, b: XY, c: XY, p: XY): number {
  return Math.min(distanceToSegment(a, b, p), distanceToSegment(b, c, p), distanceToSegment(c, a, p));
}

/** Bowyer-Watson Delaunay triangulation. Collinear input yields nothing. */
export function delaunay(pts: XY[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const d = Math.max(maxX - minX, maxY - minY, 1) * 20;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const all = [...pts, { x: mx - d, y: my - d }, { x: mx + d, y: my - d }, { x: mx, y: my + d }];
  type Tri = { v: [number, number, number]; cc: { x: number; y: number; r2: number } };
  const circum = (v: [number, number, number]): Tri | null => {
    const [a, b, c] = v.map((i) => all[i]);
    const dd = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(dd) < 1e-12) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / dd;
    const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / dd;
    return { v, cc: { x: ux, y: uy, r2: (a.x - ux) ** 2 + (a.y - uy) ** 2 } };
  };
  let tris: Tri[] = [circum([n, n + 1, n + 2])!];
  for (let i = 0; i < n; i++) {
    const p = all[i];
    const bad = tris.filter((t) => (p.x - t.cc.x) ** 2 + (p.y - t.cc.y) ** 2 < t.cc.r2 - 1e-9);
    const edges = new Map<string, [number, number]>();
    for (const t of bad)
      for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]] as [number, number][]) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [a, b]);
      }
    tris = tris.filter((t) => !bad.includes(t));
    for (const [a, b] of edges.values()) {
      const t = circum([a, b, i]);
      if (t) tris.push(t);
    }
  }
  return tris.filter((t) => t.v.every((v) => v < n)).map((t) => t.v);
}

/** Least squares for a tall 3-column system by normal equations. */
function leastSquares(rows: number[][], target: number[]): number[] | null {
  const m = 3;
  const ata = Array.from({ length: m }, () => Array<number>(m).fill(0));
  const atb = Array<number>(m).fill(0);
  rows.forEach((r, i) => {
    for (let a = 0; a < m; a++) {
      atb[a] += r[a] * target[i];
      for (let b = 0; b < m; b++) ata[a][b] += r[a] * r[b];
    }
  });
  // Gaussian elimination with partial pivoting.
  const A = ata.map((r, i) => [...r, atb[i]]);
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r, i) => r[m] / r[i]);
}
