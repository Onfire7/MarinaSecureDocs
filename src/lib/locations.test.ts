import { describe, expect, it } from "vitest";
import { breadcrumb, compareNames, labelCentre, placementStyle } from "./locations";
import { aLocation } from "../test/fixtures";

describe("compareNames", () => {
  it("sorts numerically inside names", () => {
    // Literal, not faker: "Slip 9 before Slip 14" IS the assertion.
    expect(compareNames("Slip 9", "Slip 14")).toBeLessThan(0);
    expect(["Slip 14", "Slip 9", "Slip 2"].sort(compareNames)).toEqual([
      "Slip 2",
      "Slip 9",
      "Slip 14",
    ]);
  });

  it("ignores case", () => {
    expect(compareNames("dock a", "Dock A")).toBe(0);
  });
});

describe("breadcrumb", () => {
  it("builds the path root-first", () => {
    const marina = aLocation({ id: "m", name: "Marina" });
    const dock = aLocation({ id: "d", name: "Dock C", parent_id: "m" });
    const slip = aLocation({ id: "s", name: "Slip 14", parent_id: "d" });
    const byId = new Map([marina, dock, slip].map((l) => [l.id, l]));
    expect(breadcrumb("s", byId)).toEqual(["Marina", "Dock C", "Slip 14"]);
  });

  it("is empty for an unknown or absent id", () => {
    expect(breadcrumb("nope", new Map())).toEqual([]);
    expect(breadcrumb(undefined, new Map())).toEqual([]);
  });

  it("terminates on a parent cycle", () => {
    // Bad data shouldn't hang a list page. The depth guard caps it at 20.
    const a = aLocation({ id: "a", name: "A", parent_id: "b" });
    const b = aLocation({ id: "b", name: "B", parent_id: "a" });
    const byId = new Map([a, b].map((l) => [l.id, l]));
    expect(breadcrumb("a", byId)).toHaveLength(20);
  });
});

describe("placementStyle", () => {
  it("draws the label on the anchor when there is no offset, and off it by the offset when there is", () => {
    expect(placementStyle({ cx: 40, cy: 60, rotation: 0 })).toMatchObject({ left: "40%", top: "60%" });
    expect(placementStyle({ cx: 40, cy: 60, rotation: 0, dx: 5, dy: -2.5 })).toMatchObject({ left: "45%", top: "57.5%" });
    expect(labelCentre({ cx: 40, cy: 60, rotation: 0, dx: 5 })).toEqual({ x: 45, y: 60 });
  });
  it("lays a small label out at a readable size and scales it down; a large one is laid out as it is", () => {
    const small = placementStyle({ cx: 0, cy: 0, rotation: -42, fontSize: 4, paddingX: 2, paddingY: 1 });
    expect(small.fontSize).toBe("12px");
    expect(small.padding).toBe("3px 6px");
    expect(small.transform).toBe("translate(-50%, -50%) rotate(-42deg) scale(0.3333333333333333)");
    const large = placementStyle({ cx: 0, cy: 0, rotation: 0, fontSize: 22, paddingX: 8, paddingY: 4 });
    expect(large.fontSize).toBe("22px");
    expect(large.padding).toBe("4px 8px");
    expect(large.transform).toBe("translate(-50%, -50%) rotate(0deg) scale(1)");
  });
});
