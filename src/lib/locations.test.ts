import { describe, expect, it } from "vitest";
import { breadcrumb, compareNames, defaultMapFor, placementStyle } from "./locations";
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
  it("draws the label at its own centre", () => {
    expect(placementStyle({ cx: 40, cy: 60, rotation: 0 })).toMatchObject({ left: "40%", top: "60%" });
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

// docs/maps.md § A location on several maps (tests approved 2026-10-19).
describe("defaultMapFor", () => {
  // Marina > Dock A > Slip A1; Marina > Dock B. A map is named after the
  // location it is scoped to; the overview's scope has no parent.
  const locations = [
    { id: "marina", parent_id: null },
    { id: "dockA", parent_id: "marina" },
    { id: "slipA1", parent_id: "dockA" },
    { id: "dockB", parent_id: "marina" },
  ];
  const map = (id: string, scope: string, name: string) => ({ id, name, scope_id: scope, scope_name: name, scope_parent_id: locations.find((l) => l.id === scope)!.parent_id });
  const overview = map("overview", "marina", "Marina");
  const dockAMap = map("dockA-map", "dockA", "Dock A");
  const dockBMap = map("dockB-map", "dockB", "Dock B");
  const maps = [overview, dockAMap, dockBMap];

  it("U1 · the most specific map it is on: the one scoped to its nearest ancestor", () => {
    expect(defaultMapFor("slipA1", { locations, maps, onMapIds: ["overview", "dockA-map"] })).toBe("dockA-map");
    expect(defaultMapFor("slipA1", { locations, maps, onMapIds: ["dockA-map", "overview"] })).toBe("dockA-map");
  });
  it("U1b · two equally specific - or not on its ancestors' maps at all - the first by name", () => {
    expect(defaultMapFor("slipA1", { locations, maps, onMapIds: ["dockB-map"] })).toBe("dockB-map");
    const twin = { ...map("dockA-2", "dockA", "Dock A east"), scope_name: "Dock A east" };
    expect(defaultMapFor("slipA1", { locations, maps: [...maps, twin], onMapIds: ["dockA-2", "dockA-map"] })).toBe("dockA-map");
    // An ancestor's map always beats one off the chain, whatever its name.
    expect(defaultMapFor("slipA1", { locations, maps, onMapIds: ["dockB-map", "overview"] })).toBe("overview");
  });
  it("U1c · on no map: its nearest ancestor's map, then the overview", () => {
    expect(defaultMapFor("slipA1", { locations, maps, onMapIds: [] })).toBe("dockA-map");
    expect(defaultMapFor("slipA1", { locations, maps: [overview, dockBMap], onMapIds: [] })).toBe("overview");
    expect(defaultMapFor("dockB", { locations, maps, onMapIds: [] })).toBe("overview");
    expect(defaultMapFor(null, { locations, maps, onMapIds: [] })).toBe("overview");
    expect(defaultMapFor("slipA1", { locations, maps: [], onMapIds: [] })).toBe(null);
  });
});
