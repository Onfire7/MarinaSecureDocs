import { describe, expect, it } from "vitest";
import { deterministicId } from "./detId";
import { assetTriggerInstanceId, planAssetTrigger } from "./assetTriggers";
import type { InstantiableSection, InstantiableTemplate } from "./checklists";

// Fleet Vehicle Item test 8
// (src/pages/admin/AdminChecklistTemplatesPage.spec.md § Asset triggers).

const NOW = new Date("2026-10-20T23:00:00Z");

const section = (id: string, over: Partial<InstantiableSection> = {}): InstantiableSection => ({
  id,
  name: `Section ${id}`,
  position: 0,
  is_active: 1,
  trigger_type: "asset",
  triggerConfig: { event: "check_out" },
  checkpointIds: [],
  assetIds: ["truck"],
  items: [],
  ...over,
});

const template = (id: string, sections: InstantiableSection[], trigger_type = "asset"): InstantiableTemplate => ({
  id,
  name: `Template ${id}`,
  trigger_type,
  sections,
});

const plan = (over: Partial<Parameters<typeof planAssetTrigger>[0]> = {}) =>
  planAssetTrigger({
    event: "check_out",
    assetId: "truck",
    checkoutId: "co-1",
    holderUserId: "user-gail",
    templates: [],
    openInstances: [],
    now: NOW,
    ...over,
  });

describe("planAssetTrigger (test 8)", () => {
  it("adds watching sections to the holder's open checklist from that template", () => {
    const walkaround = section("walk");
    const result = plan({
      templates: [template("patrol", [walkaround, section("other", { assetIds: ["cart"] })], "clock_in")],
      openInstances: [{ id: "inst-1", template_id: "patrol" }],
    });
    expect(result).toEqual({ add: [{ instanceId: "inst-1", section: walkaround }], create: [] });
  });

  it("creates a checklist for the holder only from an Asset Check Out/In template", () => {
    const walkaround = section("walk");
    expect(plan({ templates: [template("patrol", [walkaround], "clock_in")] })).toEqual({
      add: [],
      create: [],
    });
    const created = plan({ templates: [template("vehicle", [walkaround])] });
    expect(created.create).toEqual([
      {
        template: expect.objectContaining({ id: "vehicle" }),
        instanceId: assetTriggerInstanceId("co-1", "check_out", "vehicle"),
        sections: [walkaround],
      },
    ]);
  });

  it("derives a created checklist's id from the checkout, the event and the template", () => {
    expect(assetTriggerInstanceId("co-1", "check_in", "vehicle")).toBe(
      deterministicId("asset-trigger:co-1:check_in:vehicle"),
    );
    expect(assetTriggerInstanceId("co-1", "check_in", "vehicle")).not.toBe(
      assetTriggerInstanceId("co-1", "check_out", "vehicle"),
    );
  });

  it("matches the event, treating a section saved with none as checked out", () => {
    const onIn = section("in", { triggerConfig: { event: "check_in" } });
    const legacy = section("legacy", { triggerConfig: {} });
    const templates = [template("vehicle", [onIn, legacy])];
    expect(plan({ templates }).create[0].sections).toEqual([legacy]);
    expect(plan({ templates, event: "check_in" }).create[0].sections).toEqual([onIn]);
  });

  it("ignores inactive sections, other assets and other trigger types", () => {
    const templates = [
      template("vehicle", [
        section("off", { is_active: 0 }),
        section("cart", { assetIds: ["cart"] }),
        section("scan", { trigger_type: "checkpoint" }),
      ]),
    ];
    expect(plan({ templates })).toEqual({ add: [], create: [] });
  });

  it("respects the template's own recurrence before creating one", () => {
    const tuesdaysOnly = {
      ...template("vehicle", [section("walk")]),
      triggerConfig: { recurrenceRule: "FREQ=WEEKLY;BYDAY=TU" },
    };
    // 2026-10-20 is a Tuesday; the 21st is not.
    expect(plan({ templates: [tuesdaysOnly] }).create).toHaveLength(1);
    expect(plan({ templates: [tuesdaysOnly], now: new Date("2026-10-21T23:00:00Z") }).create).toHaveLength(0);
  });

  it("does nothing when the holder has no user account", () => {
    expect(plan({ holderUserId: null, templates: [template("vehicle", [section("walk")])] })).toEqual({
      add: [],
      create: [],
    });
  });
});
