import { describe, expect, it } from "vitest";
import { breadcrumb, compareNames } from "./locations";
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
    const dock = aLocation({ id: "d", name: "Dock C", parent: { id: "m" } });
    const slip = aLocation({ id: "s", name: "Slip 14", parent: { id: "d" } });
    const byId = new Map([marina, dock, slip].map((l) => [l.id, l]));
    expect(breadcrumb("s", byId)).toEqual(["Marina", "Dock C", "Slip 14"]);
  });

  it("is empty for an unknown or absent id", () => {
    expect(breadcrumb("nope", new Map())).toEqual([]);
    expect(breadcrumb(undefined, new Map())).toEqual([]);
  });

  it("terminates on a parent cycle", () => {
    // Bad data shouldn't hang a list page. The depth guard caps it at 20.
    const a = aLocation({ id: "a", name: "A", parent: { id: "b" } });
    const b = aLocation({ id: "b", name: "B", parent: { id: "a" } });
    const byId = new Map([a, b].map((l) => [l.id, l]));
    expect(breadcrumb("a", byId)).toHaveLength(20);
  });
});
