import { describe, expect, it } from "vitest";
import {
  planSectionCopies,
  substituteLocationName,
  type CopyContext,
  type CopySourceSection,
} from "./sectionCopy";

const DOCK_A = { id: "loc-a", name: "Dock A" };
const DOCK_B = { id: "loc-b", name: "Dock B" };
const DOCK_C = { id: "loc-c", name: "Dock C" };

function aSource(over: Partial<CopySourceSection> = {}): CopySourceSection {
  return {
    id: "sec-src",
    name: "Dock A walk",
    locationId: DOCK_A.id,
    locationName: DOCK_A.name,
    isActive: true,
    triggerType: "manual",
    triggerConfig: null,
    hideUntilRule: "22:00",
    dueBy: '{"kind":"minutes","minutes":60}',
    items: [
      { type: "door_check", label: "Gate", config: { locationId: DOCK_A.id } as never },
      { type: "simple_check", label: "Dock A lights", config: {} },
    ],
    checkpoints: [],
    assetIds: [],
    ...over,
  };
}

function aContext(over: Partial<CopyContext> = {}): CopyContext {
  let n = 0;
  return {
    templateSections: [{ id: "sec-src", locationId: DOCK_A.id }],
    checkpoints: [],
    newGuid: () => `guid-${++n}`,
    ...over,
  };
}

describe("substituteLocationName", () => {
  // Test 1
  it("replaces every occurrence of the source name, case-insensitively", () => {
    expect(substituteLocationName("Dock A walk, dock a gate", "Dock A", "Dock B")).toBe(
      "Dock B walk, Dock B gate",
    );
  });

  // Test 2
  it("appends the target name when the source name is absent, or there is none", () => {
    expect(substituteLocationName("Door check", "Dock A", "Dock B")).toBe("Door check Dock B");
    expect(substituteLocationName("Door check", null, "Dock B")).toBe("Door check Dock B");
    expect(substituteLocationName("Dock A walk", null, "Dock B")).toBe("Dock A walk Dock B");
  });
});

describe("planSectionCopies", () => {
  // Test 3
  it("repoints Door and Lock items only when they pointed at the source", () => {
    const source = aSource({
      items: [
        { type: "door_check", label: "Gate", config: { locationId: DOCK_A.id } as never },
        { type: "lock_check", label: "Shed", config: { locationId: "loc-elsewhere" } as never },
        { type: "simple_check", label: "Lights", config: { locationId: DOCK_A.id } as never },
      ],
    });
    const [copy] = planSectionCopies(source, [DOCK_B], "none", aContext()).sections;
    expect(copy.items.map((i) => (i.config as { locationId?: string }).locationId)).toEqual([
      DOCK_B.id,
      "loc-elsewhere",
      DOCK_A.id,
    ]);
  });

  // Test 4
  it("never copies End Shift, and keeps positions compact", () => {
    const source = aSource({
      items: [
        { type: "simple_check", label: "First", config: {} },
        { type: "end_shift", label: "End shift", config: {} },
        { type: "simple_check", label: "Last", config: {} },
      ],
    });
    const [copy] = planSectionCopies(source, [DOCK_B], "none", aContext()).sections;
    expect(copy.items.map((i) => [i.label, i.position])).toEqual([
      ["First Dock B", 0],
      ["Last Dock B", 1],
    ]);
  });

  // Test 5 — the plan carries no version at all; the data layer writes
  // version 1 with no previous version, as createItem does for a new row.
  it("copies the section's settings and renames by the substitution rule", () => {
    const [copy] = planSectionCopies(aSource(), [DOCK_B], "none", aContext()).sections;
    expect(copy).toMatchObject({
      name: "Dock B walk",
      locationId: DOCK_B.id,
      isActive: true,
      triggerType: "manual",
      hideUntilRule: "22:00",
      dueBy: '{"kind":"minutes","minutes":60}',
    });
    expect(copy.items.map((i) => i.label)).toEqual(["Gate Dock B", "Dock B lights"]);
    expect(Object.keys(copy.items[0])).not.toContain("version");
  });

  // Test 6
  it("'all' attaches every checkpoint at the target, and only those", () => {
    const ctx = aContext({
      checkpoints: [
        { id: "cp-b1", name: "Gate", locationId: DOCK_B.id },
        { id: "cp-b2", name: "Ramp", locationId: DOCK_B.id },
        { id: "cp-c1", name: "Gate", locationId: DOCK_C.id },
      ],
    });
    const [copy] = planSectionCopies(aSource(), [DOCK_B], "all", ctx).sections;
    expect(copy.attachCheckpointIds).toEqual(["cp-b1", "cp-b2"]);
    expect(copy.createCheckpoints).toEqual([]);
  });

  // Test 7
  it("'create' names by substitution, copies the radius, drops the fix, and reuses a same-named checkpoint", () => {
    const source = aSource({
      checkpoints: [
        { id: "cp-a1", name: "Dock A gate tag", gpsValidationRadius: 25 },
        { id: "cp-a2", name: "Ramp", gpsValidationRadius: null },
      ],
    });
    const ctx = aContext({
      checkpoints: [{ id: "cp-b-ramp", name: "ramp dock b", locationId: DOCK_B.id }],
    });
    const plan = planSectionCopies(source, [DOCK_B, DOCK_C], "create", ctx);
    const [b, c] = plan.sections;
    expect(b.attachCheckpointIds).toEqual(["cp-b-ramp"]);
    expect(b.createCheckpoints).toEqual([
      { name: "Dock B gate tag", locationId: DOCK_B.id, guidUrl: "guid-1", gpsValidationRadius: 25 },
    ]);
    expect(c.attachCheckpointIds).toEqual([]);
    expect(c.createCheckpoints.map((cp) => cp.name)).toEqual(["Dock C gate tag", "Ramp Dock C"]);
    const guids = [...b.createCheckpoints, ...c.createCheckpoints].map((cp) => cp.guidUrl);
    expect(new Set(guids).size).toBe(guids.length);
    expect(Object.keys(b.createCheckpoints[0])).not.toContain("gpsLat");
  });

  // Test 8
  it("skips the source's own location and any location already in the template", () => {
    const ctx = aContext({
      templateSections: [
        { id: "sec-src", locationId: DOCK_A.id },
        { id: "sec-c", locationId: DOCK_C.id },
      ],
    });
    const plan = planSectionCopies(aSource(), [DOCK_A, DOCK_B, DOCK_C], "none", ctx);
    expect(plan.sections.map((s) => s.locationId)).toEqual([DOCK_B.id]);
    expect(plan.skippedTargetIds).toEqual([DOCK_A.id, DOCK_C.id]);
  });

  // Test 9
  it("places copies after the source in target order and shifts what followed", () => {
    const ctx = aContext({
      templateSections: [
        { id: "sec-0", locationId: null },
        { id: "sec-src", locationId: DOCK_A.id },
        { id: "sec-2", locationId: null },
        { id: "sec-3", locationId: null },
      ],
    });
    const plan = planSectionCopies(aSource(), [DOCK_C, DOCK_B], "none", ctx);
    expect(plan.sections.map((s) => [s.locationId, s.position])).toEqual([
      [DOCK_C.id, 2],
      [DOCK_B.id, 3],
    ]);
    expect(plan.reposition).toEqual([
      { sectionId: "sec-2", position: 4 },
      { sectionId: "sec-3", position: 5 },
    ]);
  });

  // Test 10
  it("attaches the source's assets to every copy", () => {
    const source = aSource({ assetIds: ["asset-1", "asset-2"] });
    const plan = planSectionCopies(source, [DOCK_B, DOCK_C], "none", aContext());
    for (const s of plan.sections) expect(s.assetIds).toEqual(["asset-1", "asset-2"]);
  });
});
