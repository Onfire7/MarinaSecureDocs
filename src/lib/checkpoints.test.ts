import { describe, expect, it } from "vitest";
import { NO_LOCATION_LABEL, groupByLocation, locationPathResolver } from "./checkpoints";
import { aCheckpoint, aLocation } from "../test/fixtures";

describe("locationPathResolver", () => {
  it("joins ancestors into a full path", () => {
    // This is what disambiguates the "Gate" that exists on every dock.
    const path = locationPathResolver([
      aLocation({ id: "m", name: "Marina" }),
      aLocation({ id: "b", name: "Boathouses", parent_id: "m" }),
      aLocation({ id: "bh30", name: "BH30", parent_id: "b" }),
    ]);
    expect(path("bh30")).toBe("Marina → Boathouses → BH30");
  });

  it("is empty for an unknown location", () => {
    expect(locationPathResolver([])("nope")).toBe("");
  });

  it("terminates on a parent cycle", () => {
    const path = locationPathResolver([
      aLocation({ id: "a", name: "A", parent_id: "b" }),
      aLocation({ id: "b", name: "B", parent_id: "a" }),
    ]);
    expect(typeof path("a")).toBe("string");
  });
});

describe("groupByLocation", () => {
  it("groups checkpoints under their location and sorts items numerically", () => {
    const dock = { id: "d", name: "Dock C" };
    const groups = groupByLocation([
      aCheckpoint({ id: "c2", name: "Gate 10", location: dock }),
      aCheckpoint({ id: "c1", name: "Gate 2", location: dock }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((c) => c.name)).toEqual(["Gate 2", "Gate 10"]);
  });

  it("puts unlocated checkpoints last, under an explicit label", () => {
    // They're a defect to fix rather than a place to look.
    const groups = groupByLocation([
      aCheckpoint({ id: "orphan", name: "Back Door", location_id: null }),
      aCheckpoint({ id: "c1", name: "Gate", location_id: "d", location_name: "Dock C" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Dock C", NO_LOCATION_LABEL]);
  });

  it("labels groups with the full path when a resolver is supplied", () => {
    const path = locationPathResolver([
      aLocation({ id: "m", name: "Marina" }),
      aLocation({ id: "d", name: "Dock C", parent_id: "m" }),
    ]);
    const groups = groupByLocation(
      [aCheckpoint({ id: "c1", name: "Gate", location_id: "d", location_name: "Dock C" })],
      path,
    );
    expect(groups[0].label).toBe("Marina → Dock C");
  });
});
