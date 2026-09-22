import { describe, expect, it } from "vitest";
import {
  describeRule,
  isComplete,
  resolveTargets,
  type Condition,
  type RuleLocation,
  type RuleNode,
} from "./auditRules";

// A fixture shaped like the marina: a boathouse of L/R slips, a campground,
// a cabin row, one retired slip. Docs/audits.md § Rules is the spec.

const loc = (
  id: string,
  name: string,
  typeName: string,
  parentId: string | null,
  extra: Partial<RuleLocation> = {},
): RuleLocation => ({
  id,
  name,
  typeName,
  parentId,
  statusName: typeName === "Slip" || typeName === "Campsite" || typeName === "Cabin" ? "Vacant" : null,
  isVacancy: typeName === "Slip" || typeName === "Campsite" || typeName === "Cabin",
  tracksStatus: typeName === "Slip" || typeName === "Campsite" || typeName === "Cabin",
  retired: false,
  serviceIds: [],
  amenityIds: [],
  hasCurrentLease: false,
  hasActiveReservation: false,
  lastAudited: { occupancy: null, status: null },
  ...extra,
});

const LOCS: RuleLocation[] = [
  loc("gpp", "GPP", "Marina", null),
  loc("bhs", "Boathouses", "Place", "gpp"),
  loc("bh14", "BH14", "Boathouse", "bhs"),
  loc("s1l", "BH14-01L", "Slip", "bh14", { serviceIds: ["power30"], hasCurrentLease: true }),
  loc("s1r", "BH14-01R", "Slip", "bh14", { serviceIds: ["water"], statusName: "Occupied", isVacancy: false }),
  loc("s2l", "BH14-02L", "Slip", "bh14", { lastAudited: { occupancy: "2026-08-01", status: null } }),
  loc("s2r", "BH14-02R", "Slip", "bh14", { retired: true }),
  loc("bh04", "BH04", "Boathouse", "bhs"),
  loc("s4l", "BH04-01L", "Slip", "bh04"),
  loc("camp", "Campgrounds", "Place", "gpp"),
  loc("c1", "C1", "Campsite", "camp", { amenityIds: ["firepit"], hasActiveReservation: true }),
  loc("c2", "C2", "Campsite", "camp"),
  loc("cab", "Cabins", "Place", "gpp"),
  loc("cb1", "Cabin 1", "Cabin", "cab"),
];

let seq = 0;
const rule = (conditions: Condition[], extra: Partial<RuleNode> = {}): RuleNode => ({
  id: `r${++seq}`,
  mode: "all",
  conditions,
  questionIds: [],
  children: [],
  ...extra,
});
const c = (subject: Condition["subject"], verb: string, value = ""): Condition => ({ subject, verb, value });

const ids = (xs: { locationId: string }[]) => xs.map((t) => t.locationId);

describe("resolveTargets", () => {
  it("type_is selects only that type", () => {
    const { targets } = resolveTargets([rule([c("type", "is", "Campsite")])], LOCS, { kind: "occupancy" });
    expect(ids(targets)).toEqual(["c1", "c2"]);
  });

  it("under selects descendants at any depth", () => {
    const { targets } = resolveTargets([rule([c("location", "under", "bhs")])], LOCS, { kind: "occupancy" });
    // Boathouses themselves don't track status, so only the slips are targets.
    expect(ids(targets)).toEqual(["s1l", "s1r", "s2l", "s4l"]);
  });

  it("child rule narrows its parent", () => {
    const child = rule([c("name", "ends", "L")]);
    const parent = rule([c("location", "under", "bh14")], { children: [child] });
    const { selected } = resolveTargets([parent], LOCS, { kind: "occupancy" });
    const parentSel = [...selected.get(parent.id)!];
    const childSel = [...selected.get(child.id)!];
    expect(childSel).toEqual(["s1l", "s2l"]);
    expect(childSel.every((id) => parentSel.includes(id))).toBe(true);
    // BH04-01L also ends with L, but is not under BH14, so the child never sees it.
    expect(childSel).not.toContain("s4l");
    expect(parentSel).toEqual(["s1l", "s1r", "s2l"]);
  });

  it("parent-only match is a target with no questions", () => {
    const left = rule([c("name", "ends", "L")], { questionIds: ["q-power"] });
    const right = rule([c("name", "ends", "R")], { questionIds: ["q-water"] });
    const parent = rule([c("location", "under", "bh14")], { children: [left, right] });
    // Rename one slip so neither child catches it.
    const locs = LOCS.map((l) => (l.id === "s2l" ? { ...l, name: "BH14-02X" } : l));
    const { targets } = resolveTargets([parent], locs, { kind: "occupancy" });
    const odd = targets.find((t) => t.locationId === "s2l")!;
    expect(odd).toBeDefined();
    expect(odd.questionIds).toEqual([]);
    expect(targets.find((t) => t.locationId === "s1l")!.questionIds).toEqual(["q-power"]);
  });

  it("sibling rules each ask their questions once", () => {
    const left = rule([c("name", "ends", "L")], { questionIds: ["q-power"] });
    const first = rule([c("name", "contains", "-01")], { questionIds: ["q-first", "q-power"] });
    const parent = rule([c("location", "under", "bh14")], { children: [left, first] });
    const { targets } = resolveTargets([parent], LOCS, { kind: "occupancy" });
    const s1l = targets.find((t) => t.locationId === "s1l")!;
    expect(s1l.questionIds).toEqual(["q-power", "q-first"]);
    expect(s1l.ruleIds).toEqual([parent.id, left.id, first.id]);
    expect(targets.filter((t) => t.locationId === "s1l")).toHaveLength(1);
  });

  it("and, or, not compose when nested", () => {
    // any of: (has power) / (has water)  → s1l, s1r
    const anyOf = rule([c("service", "has", "power30"), c("service", "has", "water")], { mode: "any" });
    expect(ids(resolveTargets([anyOf], LOCS, { kind: "status" }).targets)).toEqual(["s1l", "s1r"]);
    // all of: under bh14, name does not end with R → s1l, s2l
    const allOf = rule([c("location", "under", "bh14"), c("name", "not_ends", "R")]);
    expect(ids(resolveTargets([allOf], LOCS, { kind: "status" }).targets)).toEqual(["s1l", "s2l"]);
    // nested: any-of parent narrowed by an all-of child
    const child = rule([c("lease", "current")]);
    const parent = rule([c("service", "has", "power30"), c("service", "has", "water")], { mode: "any", children: [child] });
    const { selected } = resolveTargets([parent], LOCS, { kind: "status" });
    expect([...selected.get(child.id)!]).toEqual(["s1l"]);
  });

  it("is_vacant reads the status flag", () => {
    const locs = LOCS.map((l) =>
      l.id === "s2l" ? { ...l, statusName: "Needs Cleaning", isVacancy: true } : l,
    );
    const { targets } = resolveTargets([rule([c("location", "under", "bh14"), c("status", "vacant")])], locs, {
      kind: "occupancy",
    });
    // "Needs Cleaning" counts as vacant by its flag; "Occupied" does not.
    expect(ids(targets)).toEqual(["s1l", "s2l"]);
    const not = resolveTargets([rule([c("location", "under", "bh14"), c("status", "not_vacant")])], locs, {
      kind: "occupancy",
    });
    expect(ids(not.targets)).toEqual(["s1r"]);
  });

  it("last_audited_before ignores audits of the other kind", () => {
    const r = rule([c("location", "under", "bh14"), c("last_audited", "before", "2026-09-01")]);
    // s2l had an occupancy audit on 08-01: before the date, so still selected
    // for occupancy. s1l has never been audited: selected.
    expect(ids(resolveTargets([r], LOCS, { kind: "occupancy" }).targets)).toEqual(["s1l", "s1r", "s2l"]);
    const recent = LOCS.map((l) =>
      l.id === "s2l" ? { ...l, lastAudited: { occupancy: "2026-09-15", status: null } } : l,
    );
    // Audited for occupancy after the date: excluded from an occupancy audit…
    expect(ids(resolveTargets([r], recent, { kind: "occupancy" }).targets)).toEqual(["s1l", "s1r"]);
    // …but a status audit does not count that, so s2l is back.
    expect(ids(resolveTargets([r], recent, { kind: "status" }).targets)).toEqual(["s1l", "s1r", "s2l"]);
  });

  it("retired locations are never targets", () => {
    const { targets, selected } = resolveTargets([rule([c("name", "contains", "BH14-02")])], LOCS, {
      kind: "occupancy",
    });
    expect(ids(targets)).toEqual(["s2l"]);
    // Not even selected — a retired row is invisible to rules.
    expect([...selected.values()][0].has("s2r")).toBe(false);
  });

  it("non-status-tracking types are excluded unless named by type_is", () => {
    const under = rule([c("location", "under", "gpp")]);
    expect(ids(resolveTargets([under], LOCS, { kind: "status" }).targets)).not.toContain("bh14");
    const named = rule([c("type", "is", "Boathouse")]);
    expect(ids(resolveTargets([named], LOCS, { kind: "status" }).targets)).toEqual(["bh14", "bh04"]);
  });

  it("targets are ordered by tree position", () => {
    // Rules in "wrong" order; output must follow the location tree, parent
    // before children, siblings in the order the caller supplied.
    const camp = rule([c("type", "is", "Campsite")]);
    const slips = rule([c("type", "is", "Slip")]);
    const { targets } = resolveTargets([camp, slips], LOCS, { kind: "occupancy" });
    expect(ids(targets)).toEqual(["s1l", "s1r", "s2l", "s4l", "c1", "c2"]);
  });
});

describe("isComplete and describeRule", () => {
  it("a condition with a value-taking verb and no value is inert", () => {
    expect(isComplete(c("name", "ends", ""))).toBe(false);
    expect(isComplete(c("name", "ends", "L"))).toBe(true);
    expect(isComplete(c("status", "vacant"))).toBe(true);
    const { targets } = resolveTargets([rule([c("location", "under", "bh14"), c("name", "ends", "")])], LOCS, {
      kind: "occupancy",
    });
    expect(ids(targets)).toEqual(["s1l", "s1r", "s2l"]);
    expect(describeRule(rule([c("name", "ends", "")]), () => "")).toBe("everything");
  });

  it("reads as a sentence", () => {
    const named = (id: string) => (id === "bh14" ? "BH14" : "?");
    expect(describeRule(rule([c("location", "under", "bh14"), c("name", "ends", "L")]), named)).toBe(
      "Location is under BH14 and Name ends with “L”",
    );
    expect(describeRule(rule([c("status", "vacant"), c("lease", "absent")], { mode: "any" }), named)).toBe(
      "Status counts as vacant or Lease is absent",
    );
  });
});
