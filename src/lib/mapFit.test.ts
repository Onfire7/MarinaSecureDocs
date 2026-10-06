import { describe, expect, it } from "vitest";
import { buildMapFit, controlPointsFor, fitAffine, mergeControlPoints, type ControlPoint } from "./mapFit";
import { distanceMeters } from "./geo";

// A marina 200 m wide and 120 m deep at Grandpappy Point's latitude, drawn
// on a map by functions that stand in for the artist's hand.
const LAT0 = 33.8;
const LNG0 = -96.6;
const gps = (x: number, y: number) => ({ lat: LAT0 + y / 110_574, lng: LNG0 + x / (111_320 * Math.cos((LAT0 * Math.PI) / 180)) });
type Drawing = (x: number, y: number) => { cx: number; cy: number };
const point = (draw: Drawing, x: number, y: number, label?: string): ControlPoint => ({ ...draw(x, y), ...gps(x, y), label });

/** Drawn to scale, rotated 30°, and stretched more in y than x. */
const toScale: Drawing = (x, y) => {
  const a = (30 * Math.PI) / 180;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  return { cx: 20 + rx * 0.3, cy: 70 - ry * 0.45 };
};
/** The artist drew the left half at twice the scale of the right half. */
const uneven: Drawing = (x, y) => ({ cx: 5 + (x < 100 ? x * 0.6 : 60 + (x - 100) * 0.3), cy: 10 + y * 0.6 });
/** No rotation, half a percent per metre in x and a quarter in y. */
const plain: Drawing = (x, y) => ({ cx: 10 + x * 0.5, cy: 10 + y * 0.25 });

const grid = (draw: Drawing, xs: number[], ys: number[]) => xs.flatMap((x) => ys.map((y) => point(draw, x, y, `${x},${y}`)));

describe("buildMapFit", () => {
  it("1 · fewer than three usable points, or three in a line, is no fit", () => {
    expect(buildMapFit(grid(plain, [0, 200], [0]))).toBeNull();
    expect(buildMapFit(grid(plain, [0, 100, 200], [0]))).toBeNull();
    expect(buildMapFit([point(plain, 0, 0), point(plain, 200, 0), point(plain, 0, 120)])).not.toBeNull();
  });

  it("2 · a map drawn to scale places held-out positions within a tenth of a percent", () => {
    const fit = buildMapFit(grid(toScale, [0, 100, 200], [0, 120]))!;
    expect(fit).not.toBeNull();
    for (const [x, y] of [[30, 40], [150, 90], [100, 60], [190, 10]]) {
      const want = toScale(x, y);
      const got = fit.toMap(gps(x, y).lat, gps(x, y).lng);
      expect(got.inside).toBe(true);
      expect(Math.abs(got.cx - want.cx)).toBeLessThan(0.1);
      expect(Math.abs(got.cy - want.cy)).toBeLessThan(0.1);
    }
  });

  it("3 · uneven scale is right locally, where a single affine fit is not", () => {
    const points = grid(uneven, [0, 100, 200], [0, 120]);
    const fit = buildMapFit(points)!;
    const affine = fitAffine(points)!;
    for (const [x, y] of [[50, 60], [150, 60]]) {
      const want = uneven(x, y);
      const g = gps(x, y);
      const piecewise = fit.toMap(g.lat, g.lng);
      const global = affine(g.lat, g.lng);
      expect(Math.abs(piecewise.cx - want.cx)).toBeLessThan(0.05);
      expect(Math.abs(global.cx - want.cx)).toBeGreaterThan(1);
    }
  });

  it("4 · outside the calibrated area is extrapolated, says so, and is continuous at the edge", () => {
    const fit = buildMapFit(grid(toScale, [0, 100, 200], [0, 120]))!;
    const out = fit.toMap(gps(-20, 60).lat, gps(-20, 60).lng);
    expect(out.inside).toBe(false);
    const want = toScale(-20, 60);
    expect(Math.abs(out.cx - want.cx)).toBeLessThan(0.1);
    const edgeIn = fit.toMap(gps(0.01, 60).lat, gps(0.01, 60).lng);
    const edgeOut = fit.toMap(gps(-0.01, 60).lat, gps(-0.01, 60).lng);
    expect(edgeIn.inside).toBe(true);
    expect(edgeOut.inside).toBe(false);
    expect(Math.hypot(edgeIn.cx - edgeOut.cx, edgeIn.cy - edgeOut.cy)).toBeLessThan(0.05);
  });

  it("5 · map to GPS to map comes back to where it started", () => {
    const fit = buildMapFit(grid(uneven, [0, 100, 200], [0, 120]))!;
    for (const [x, y] of [[40, 30], [160, 100]]) {
      const start = gps(x, y);
      const m = fit.toMap(start.lat, start.lng);
      const back = fit.toGps(m.cx, m.cy);
      expect(back.inside).toBe(true);
      expect(distanceMeters(start.lat, start.lng, back.lat, back.lng)).toBeLessThan(0.1);
    }
  });

  it("6 · a wrong pin has the largest leave-one-out residual, and names itself", () => {
    const points = grid(plain, [0, 100, 200], [0, 60, 120]);
    const wrong = points.find((p) => p.label === "100,60")!;
    const moved = gps(100 + 40, 60);
    wrong.lat = moved.lat;
    wrong.lng = moved.lng;
    const residuals = buildMapFit(points)!.residuals();
    expect(residuals[0].point.label).toBe("100,60");
    expect(residuals[0].errorMeters).toBeGreaterThan(30);
    expect(residuals[0].errorMeters).toBeLessThan(50);
    for (const r of residuals.slice(1)) expect(r.errorMeters).toBeLessThan(residuals[0].errorMeters / 2);
  });

  it("7 · a point recorded twice is one point, not a sliver of a triangle", () => {
    const points = [...grid(plain, [0, 200], [0, 120]), point(plain, 0.1, 0.1, "again")];
    expect(mergeControlPoints(points)).toHaveLength(4);
    const fit = buildMapFit(points)!;
    expect(fit.points).toHaveLength(4);
    expect(fit.triangles.length).toBeGreaterThan(0);
    const g = gps(100, 60);
    expect(Math.abs(fit.toMap(g.lat, g.lng).cx - plain(100, 60).cx)).toBeLessThan(0.1);
  });

  it("8 · control points are the anchors with coordinates; a provisional one supersedes the saved one", () => {
    const anchors = [
      { cx: 10, cy: 10, lat: 33.8, lng: -96.6, label: "Slip 1", locationId: "a" },
      { cx: 50, cy: 50, lat: null, lng: null, label: "Slip 2", locationId: "b" },
      { cx: 90, cy: 90, lat: 33.82, lng: -96.62, label: "NE corner", locationId: null },
      { cx: 12, cy: 11, lat: 33.801, lng: -96.601, label: "Slip 1", locationId: "a", provisional: true },
    ];
    expect(controlPointsFor(anchors)).toEqual([
      { cx: 90, cy: 90, lat: 33.82, lng: -96.62, label: "NE corner", provisional: undefined },
      { cx: 12, cy: 11, lat: 33.801, lng: -96.601, label: "Slip 1", provisional: true },
    ]);
  });
  it("9 · an accuracy radius in metres is the right size on the map, axis by axis", () => {
    const fit = buildMapFit(grid(plain, [0, 100, 200], [0, 60, 120]))!;
    const g = gps(100, 60);
    const r = fit.radiusAt(g.lat, g.lng, 10);
    expect(r.rx).toBeCloseTo(5, 1);
    expect(r.ry).toBeCloseTo(2.5, 1);
  });
});
