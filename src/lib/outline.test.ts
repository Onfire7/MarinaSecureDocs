import { describe, expect, it } from "vitest";
import { cleanOutline, insideOutline, outlineCentre, parseOutline, type OutlinePoint } from "./outline";

describe("cleanOutline", () => {
  it("1 · drops repeated corners, a closing corner on the first, and clamps to the image", () => {
    expect(cleanOutline([[10, 10], [10, 10], [50, 10], [50, 120], [10.01, 10.01]])).toEqual([[10, 10], [50, 10], [50, 100]]);
    expect(cleanOutline([[-5, 20], [40, 20], [40, 60]])).toEqual([[0, 20], [40, 20], [40, 60]]);
  });
  it("1b · fewer than three corners, or no area inside them, is not an outline", () => {
    expect(cleanOutline([[10, 10], [20, 20]])).toBeNull();
    expect(cleanOutline([[10, 10], [20, 20], [30, 30]])).toBeNull();
    expect(cleanOutline([[10, 10], [10, 10], [10, 10]])).toBeNull();
    expect(cleanOutline(null)).toBeNull();
  });
});

describe("outlineCentre", () => {
  it("2 · is inside a convex shape - its centroid", () => {
    const square: OutlinePoint[] = [[10, 10], [30, 10], [30, 30], [10, 30]];
    expect(outlineCentre(square)).toEqual({ x: 20, y: 20 });
  });
  it("2b · is inside an L, whose centroid is not", () => {
    // A thin L: the centroid lands in the empty corner.
    const l: OutlinePoint[] = [[0, 0], [10, 0], [10, 90], [100, 90], [100, 100], [0, 100]];
    const c = outlineCentre(l);
    expect(insideOutline(l, c.x, c.y)).toBe(true);
  });
});

describe("parseOutline", () => {
  it("3 · reads the stored text, and anything else is no outline", () => {
    expect(parseOutline("[[10,10],[50,10],[50,50]]")).toEqual([[10, 10], [50, 10], [50, 50]]);
    expect(parseOutline(null)).toBeNull();
    expect(parseOutline("not json")).toBeNull();
  });
});
