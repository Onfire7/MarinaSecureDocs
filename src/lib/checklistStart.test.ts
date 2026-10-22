import { describe, expect, it } from "vitest";
import { clockInTemplates, manualStartOptions } from "./checklistStart";

const SEC = "role-security";
const MAINT = "role-maintenance";

const tpl = (id: string, name: string, trigger_type: string, role: string | null = SEC) => ({
  id,
  name,
  trigger_type,
  assigned_role_id: role,
  work: true,
});

describe("clockInTemplates", () => {
  // Test 1
  it("returns every Clock In template of my roles that has work, in name order", () => {
    const templates = [
      tpl("sec", "Security Checklist", "clock_in"),
      tpl("dock", "Dock Walks", "clock_in"),
      tpl("maint", "Maintenance Clock In", "clock_in", MAINT),
      { ...tpl("empty", "Empty", "clock_in"), work: false },
      tpl("manual", "Manual round", "manual"),
    ];
    const got = clockInTemplates(templates, [SEC], (t) => t.work);
    expect(got.map((t) => t.id)).toEqual(["dock", "sec"]);
  });

  // Test 2
  it("ignores a template with no role", () => {
    const got = clockInTemplates([tpl("x", "Orphan", "clock_in", null)], [SEC], () => true);
    expect(got).toEqual([]);
  });
});

describe("manualStartOptions", () => {
  const templates = [
    tpl("dock", "Dock Walks", "clock_in"),
    tpl("manual", "Incident walk", "manual"),
    tpl("weekly", "Weekly check", "recurring"),
  ];

  // Test 3
  it("puts Manual templates first, then triggered ones labelled with their trigger", () => {
    const got = manualStartOptions(templates, [SEC], "me", []);
    expect(got.map((o) => [o.template.id, o.manual, o.triggerLabel])).toEqual([
      ["manual", true, ""],
      ["dock", false, "Clock In"],
      ["weekly", false, "Recurring"],
    ]);
  });

  // Test 4
  it("skips a triggered template with an open instance that is mine", () => {
    const got = manualStartOptions(templates, [SEC], "me", [
      { template_id: "dock", assigned_to_id: "me", status: "in_progress" },
      { template_id: "weekly", assigned_to_id: null, status: "not_started", assigned_role_id: SEC },
    ]);
    expect(got.map((o) => o.template.id)).toEqual(["manual"]);
  });

  // Test 5
  it("keeps a triggered template whose only instance is complete, or someone else's", () => {
    const got = manualStartOptions(templates, [SEC], "me", [
      { template_id: "dock", assigned_to_id: "me", status: "complete" },
      { template_id: "weekly", assigned_to_id: "someone-else", status: "in_progress" },
    ]);
    expect(got.map((o) => o.template.id)).toEqual(["manual", "dock", "weekly"]);
  });

  // Test 6
  it("never skips a Manual template", () => {
    const got = manualStartOptions(templates, [SEC], "me", [
      { template_id: "manual", assigned_to_id: "me", status: "in_progress" },
    ]);
    expect(got.map((o) => o.template.id)).toContain("manual");
  });

  // Test 7
  it("excludes other roles' templates, and is empty when nothing matches", () => {
    expect(manualStartOptions(templates, [MAINT], "me", [])).toEqual([]);
    expect(manualStartOptions([tpl("m", "Maint", "manual", MAINT), ...templates], [MAINT], "me", []).map((o) => o.template.id)).toEqual(["m"]);
  });
});
