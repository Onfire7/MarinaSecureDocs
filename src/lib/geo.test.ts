import { describe, expect, it } from "vitest";
import { distanceMeters } from "./geo";

describe("distanceMeters", () => {
  it("is zero for identical points", () => {
    expect(distanceMeters(44.9, -87.1, 44.9, -87.1)).toBe(0);
  });

  it("matches a known great-circle distance", () => {
    // One degree of longitude at the equator is ~111.19 km.
    expect(distanceMeters(0, 0, 0, 1)).toBeGreaterThan(111_000);
    expect(distanceMeters(0, 0, 0, 1)).toBeLessThan(111_400);
  });

  it("stays finite at antipodes", () => {
    // Rounding can push the haversine term just above 1, and asin(>1) is
    // NaN. A NaN here would silently fail every GPS check-in radius test.
    expect(Number.isFinite(distanceMeters(0, 0, 0, 180))).toBe(true);
    expect(Number.isFinite(distanceMeters(90, 0, -90, 0))).toBe(true);
  });

  it("is symmetric", () => {
    expect(distanceMeters(44.9, -87.1, 44.91, -87.11)).toBeCloseTo(
      distanceMeters(44.91, -87.11, 44.9, -87.1),
      6,
    );
  });
});
