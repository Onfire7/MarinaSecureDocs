import { describe, expect, it } from "vitest";
import {
  instanceItemId,
  planChecklistUpdate,
  versionLineage,
  type OpenChecklist,
  type OpenSection,
  type UpdateOp,
} from "./checklistUpdate";
import type { InstantiableSection, InstantiableTemplate } from "./checklists";

// 2026-08-25 is a Tuesday. Every checklist here was created at 18:00 that day
// and is being updated at 19:00, unless a test says otherwise.
const CREATED = new Date(2026, 7, 25, 18, 0, 0);
const NOW = new Date(2026, 7, 25, 19, 0, 0);
const at = (h: number, m = 0, day = 25) => new Date(2026, 7, day, h, m, 0).getTime();

function item(id: string, position = 0, label = id) {
  return { id, type: "simple_check", label, position, config: {} };
}

function section(
  id: string,
  items: ReturnType<typeof item>[],
  extra: Partial<InstantiableSection> = {},
): InstantiableSection {
  return {
    id,
    name: `Section ${id}`,
    position: 0,
    is_active: 1,
    trigger_type: "manual",
    triggerConfig: null,
    hide_until_rule: null,
    dueBy: null,
    location_id: null,
    location_status_name: null,
    checkpointIds: [],
    assetIds: [],
    items,
    ...extra,
  };
}

function template(
  sections: InstantiableSection[],
  extra: Partial<InstantiableTemplate> = {},
): InstantiableTemplate {
  return {
    id: "tpl",
    name: "Night round",
    trigger_type: "manual",
    triggerConfig: null,
    assigned_to_user: 0,
    hide_until_rule: null,
    expected_start: null,
    dueBy: null,
    assigned_role_id: "role",
    sections,
    ...extra,
  };
}

/** The open checklist a template would have produced at CREATED. */
function checklistFrom(tpl: InstantiableTemplate, extra: Partial<OpenChecklist> = {}): OpenChecklist {
  return {
    id: "chk",
    hide_until: null,
    due_by: null,
    expected_start_at: null,
    created_at: CREATED.toISOString(),
    sections: tpl.sections
      .filter((s) => s.is_active === 1 && s.trigger_type === "manual")
      .map((s) => sectionFrom(s)),
    ...extra,
  };
}

function sectionFrom(s: InstantiableSection, extra: Partial<OpenSection> = {}): OpenSection {
  const sid = `inst-${s.id}`;
  return {
    id: sid,
    template_section_id: s.id,
    label: s.name,
    position: s.position,
    location_id: s.location_id ?? null,
    hide_until: null,
    due_by: null,
    created_at: CREATED.toISOString(),
    items: s.items.map((i) => ({
      id: instanceItemId(sid, i.id),
      template_item_id: i.id,
      position: i.position,
      completed_at: null,
      result: null,
      note: null,
    })),
    ...extra,
  };
}

const plan = (
  chk: OpenChecklist,
  tpl: InstantiableTemplate,
  lineage = new Map<string, string>(),
  now = NOW,
) => planChecklistUpdate(chk, tpl, lineage, now);

describe("planChecklistUpdate", () => {
  it("plans nothing for a checklist that matches its template", () => {
    const tpl = template([section("a", [item("a1"), item("a2", 1)])]);
    expect(plan(checklistFrom(tpl), tpl)).toEqual([]);
  });

  it("repoints an unanswered item to its current version, through any number of edits", () => {
    const before = template([section("a", [item("v1", 3)])]);
    const chk = checklistFrom(before);
    const after = template([section("a", [item("v3", 0, "Reworded")])]);
    const lineage = versionLineage(
      [
        { id: "v2", previous_version_id: "v1" },
        { id: "v3", previous_version_id: "v2" },
      ],
      ["v3"],
    );
    const ops = plan(chk, after, lineage);
    expect(ops).toEqual([
      { op: "repointItem", itemId: instanceItemId("inst-a", "v1"), templateItemId: "v3" },
    ]);
  });

  it.each([
    ["completed", { completed_at: CREATED.toISOString(), result: '{"type":"simple_check"}' }],
    ["given a note only", { note: "Gate was chained" }],
    [
      "a location check whose nested checklist has started",
      { result: '{"type":"location_check","nestedChecklistId":"n"}' },
    ],
  ])("leaves an item %s exactly as it was answered", (_, answer) => {
    const before = template([section("a", [item("v1"), item("gone", 1)])]);
    const chk = checklistFrom(before);
    for (const it of chk.sections[0].items) Object.assign(it, answer);
    const after = template([section("a", [item("v2")])]);
    const lineage = versionLineage([{ id: "v2", previous_version_id: "v1" }], ["v2"]);
    expect(plan(chk, after, lineage)).toEqual([]);
  });

  it("adds a new item to a section the checklist has, and not to one it lacks", () => {
    const before = template([
      section("a", [item("a1")]),
      section("cp", [item("cp1")], { trigger_type: "checkpoint" }),
    ]);
    const chk = checklistFrom(before);
    const after = template([
      section("a", [item("a1"), item("a2", 4)]),
      section("cp", [item("cp1"), item("cp2", 1)], { trigger_type: "checkpoint" }),
    ]);
    expect(plan(chk, after)).toEqual([
      {
        op: "addItem",
        sectionId: "inst-a",
        itemId: instanceItemId("inst-a", "a2"),
        templateItemId: "a2",
        position: 4,
      },
    ]);
  });

  it("deletes a removed item if unanswered and keeps it if answered", () => {
    const before = template([section("a", [item("keep"), item("drop", 1), item("done", 2)])]);
    const chk = checklistFrom(before);
    chk.sections[0].items[2].completed_at = CREATED.toISOString();
    const after = template([section("a", [item("keep")])]);
    expect(plan(chk, after)).toEqual([
      { op: "removeItem", itemId: instanceItemId("inst-a", "drop") },
    ]);
  });

  it("does not copy the template's item order over the guard's", () => {
    const before = template([section("a", [item("a1", 0), item("a2", 1)])]);
    const chk = checklistFrom(before);
    // The guard dragged a2 to the top.
    chk.sections[0].items[0].position = 1;
    chk.sections[0].items[1].position = 0;
    const after = template([section("a", [item("a1", 5), item("a2", 9)])]);
    expect(plan(chk, after)).toEqual([]);
  });

  it("takes a section's current name, position and location", () => {
    const before = template([section("a", [item("a1")])]);
    const chk = checklistFrom(before);
    const after = template([
      section("a", [item("a1")], { name: "Fuel dock", position: 2, location_id: "loc" }),
    ]);
    expect(plan(chk, after)).toEqual([
      {
        op: "updateSection",
        sectionId: "inst-a",
        changes: { label: "Fuel dock", position: 2, location_id: "loc" },
      },
    ]);
  });

  it("adds new sections only of the kinds created with a checklist, and only when eligible", () => {
    const before = template([section("a", [item("a1")])]);
    const chk = checklistFrom(before);
    const after = template([
      section("a", [item("a1")]),
      section("new", [item("n1")]),
      section("off", [item("o1")], { is_active: 0 }),
      section("cp", [item("c1")], { trigger_type: "checkpoint" }),
      section("loc", [item("l1")], { trigger_type: "location" }),
      section("asset", [item("x1")], { trigger_type: "asset" }),
      // Tuesday only. Updated on Wednesday, it still belongs on a checklist
      // created on Tuesday.
      section("tue", [item("t1")], {
        trigger_type: "recurring",
        triggerConfig: { recurrenceRule: "FREQ=WEEKLY;BYDAY=TU" },
      }),
      section("wed", [item("w1")], {
        trigger_type: "recurring",
        triggerConfig: { recurrenceRule: "FREQ=WEEKLY;BYDAY=WE" },
      }),
    ]);
    const wednesday = new Date(2026, 7, 26, 1, 0, 0);
    expect(plan(chk, after, new Map(), wednesday)).toEqual([
      { op: "addSection", checklistId: "chk", templateSectionId: "new" },
      { op: "addSection", checklistId: "chk", templateSectionId: "tue" },
    ]);
  });

  it("removes a deleted or deactivated section unless something in it is answered", () => {
    const before = template([
      section("deleted", [item("d1")]),
      section("off", [item("o1")]),
      section("answered", [item("x1")]),
    ]);
    const chk = checklistFrom(before);
    chk.sections[2].items[0].note = "seen";
    const after = template([
      section("off", [item("o1")], { is_active: 0 }),
      section("answered", [item("x1")], { is_active: 0 }),
    ]);
    expect(plan(chk, after)).toEqual([
      { op: "removeSection", sectionId: "inst-deleted" },
      { op: "removeSection", sectionId: "inst-off" },
    ]);
  });

  it("recomputes a hidden section's times, from the anchor when there is one", () => {
    const before = template([
      section("hidden", [item("h1")], { hide_until_rule: "20:00" }),
      section("anchored", [item("a1")], { hide_until_rule: "20:00" }),
    ]);
    const unanchored = checklistFrom(before);
    unanchored.sections[0].hide_until = new Date(at(20)).toISOString();
    const after = template([
      section("hidden", [item("h1")], {
        hide_until_rule: "21:30",
        dueBy: { kind: "offset", minutes: 240 },
      }),
    ]);
    expect(plan({ ...unanchored, sections: [unanchored.sections[0]] }, after)).toEqual([
      {
        op: "updateSection",
        sectionId: "inst-hidden",
        // Due 240 minutes after the section was created, not after the update.
        changes: { hide_until: at(21, 30), due_by: at(22) },
      },
    ]);

    // Anchored to 17:00 on the 24th: an evening checklist still open at 19:00
    // the next day dates its 21:30 reveal from the evening it belongs to.
    const anchored = checklistFrom(before, {
      expected_start_at: new Date(at(17, 0, 24)).toISOString(),
    });
    const s = { ...anchored.sections[1], hide_until: new Date(at(20, 0, 25)).toISOString() };
    const anchoredAfter = template([
      section("anchored", [item("a1")], { hide_until_rule: "19:30" }),
    ]);
    expect(plan({ ...anchored, sections: [s] }, anchoredAfter)).toEqual([
      { op: "updateSection", sectionId: "inst-anchored", changes: { hide_until: at(19, 30, 24) } },
    ]);
  });

  it("leaves a visible section's times alone, even though its rule changed", () => {
    const before = template([section("a", [item("a1")], { hide_until_rule: "18:30" })]);
    const chk = checklistFrom(before);
    chk.sections[0].hide_until = new Date(at(18, 30)).toISOString();
    const after = template([
      section("a", [item("a1")], { hide_until_rule: "23:00", dueBy: { kind: "offset", minutes: 30 } }),
    ]);
    expect(plan(chk, after)).toEqual([]);
  });

  it("recomputes a hidden checklist's times, and leaves a visible one's alone", () => {
    const before = template([section("a", [item("a1")])], { hide_until_rule: "20:00" });
    const after = template([section("a", [item("a1")])], {
      hide_until_rule: "21:00",
      dueBy: { kind: "time", time: "06:00" },
    });

    const hidden = checklistFrom(before, { hide_until: new Date(at(20)).toISOString() });
    expect(plan(hidden, after)).toEqual([
      { op: "setChecklistTimes", checklistId: "chk", hide_until: at(21), due_by: at(6, 0, 26) },
    ]);

    const visible = checklistFrom(before, { hide_until: new Date(at(18, 30)).toISOString() });
    expect(plan(visible, after)).toEqual([]);
  });

  it("without a created_at, leaves due-by alone and resolves hide-until from now", () => {
    const before = template([section("a", [item("a1")])], { hide_until_rule: "20:00" });
    const after = template([section("a", [item("a1")])], {
      hide_until_rule: "21:00",
      dueBy: { kind: "offset", minutes: 60 },
    });
    const chk = checklistFrom(before, {
      created_at: null,
      hide_until: new Date(at(20)).toISOString(),
    });
    expect(plan(chk, after)).toEqual([
      { op: "setChecklistTimes", checklistId: "chk", hide_until: at(21) },
    ]);
  });

  it("never applies assignment, trigger, viewer roles or name", () => {
    const before = template([section("a", [item("a1")])]);
    const after = template([section("a", [item("a1")])], {
      name: "Renamed",
      assigned_role_id: "other-role",
      assigned_to_user: 1,
      trigger_type: "recurring",
      triggerConfig: { recurrenceRule: "FREQ=DAILY" },
    });
    expect(plan(checklistFrom(before), after)).toEqual([]);
  });

  it("plans nothing the second time, once its plan is applied", () => {
    const before = template(
      [
        section("a", [item("v1"), item("drop", 1), item("done", 2)], { hide_until_rule: "20:00" }),
        section("gone", [item("g1")]),
      ],
      { hide_until_rule: "20:00" },
    );
    const chk = checklistFrom(before, { hide_until: new Date(at(20)).toISOString() });
    chk.sections[0].hide_until = new Date(at(20)).toISOString();
    chk.sections[0].items[2].completed_at = CREATED.toISOString();
    const after = template(
      [
        section("a", [item("v2"), item("done", 2), item("new", 3)], {
          name: "Renamed",
          hide_until_rule: "21:00",
          dueBy: { kind: "offset", minutes: 90 },
        }),
        section("b", [item("b1")], { position: 1 }),
      ],
      { hide_until_rule: "22:00", dueBy: { kind: "time", time: "06:00" } },
    );
    const lineage = versionLineage([{ id: "v2", previous_version_id: "v1" }], ["v2", "done", "new", "b1"]);

    const first = plan(chk, after, lineage);
    expect(first.length).toBeGreaterThan(0);
    const applied = applyInMemory(chk, first, after);
    expect(plan(applied, after, lineage)).toEqual([]);
  });
});

describe("versionLineage", () => {
  it("maps every ancestor, and every current item, to the current version", () => {
    const lineage = versionLineage(
      [
        { id: "b", previous_version_id: "a" },
        { id: "c", previous_version_id: "b" },
        { id: "y", previous_version_id: "x" },
      ],
      ["c", "solo"],
    );
    expect(Object.fromEntries(lineage)).toEqual({ a: "c", b: "c", c: "c", solo: "solo" });
  });
});

/** What the data layer does with a plan, done to the fixture instead. */
function applyInMemory(
  chk: OpenChecklist,
  ops: UpdateOp[],
  tpl: InstantiableTemplate,
): OpenChecklist {
  const next: OpenChecklist = structuredClone(chk);
  const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
  for (const op of ops) {
    switch (op.op) {
      case "setChecklistTimes":
        if ("hide_until" in op) next.hide_until = iso(op.hide_until);
        if ("due_by" in op) next.due_by = iso(op.due_by);
        break;
      case "updateSection": {
        const s = next.sections.find((x) => x.id === op.sectionId)!;
        const { hide_until, due_by, ...rest } = op.changes;
        Object.assign(s, rest);
        if ("hide_until" in op.changes) s.hide_until = iso(hide_until);
        if ("due_by" in op.changes) s.due_by = iso(due_by);
        break;
      }
      case "addSection": {
        const ts = tpl.sections.find((x) => x.id === op.templateSectionId)!;
        next.sections.push(sectionFrom(ts, { created_at: NOW.toISOString() }));
        break;
      }
      case "removeSection":
        next.sections = next.sections.filter((x) => x.id !== op.sectionId);
        break;
      case "repointItem":
        for (const s of next.sections)
          for (const i of s.items) if (i.id === op.itemId) i.template_item_id = op.templateItemId;
        break;
      case "addItem":
        next.sections
          .find((x) => x.id === op.sectionId)!
          .items.push({
            id: op.itemId,
            template_item_id: op.templateItemId,
            position: op.position,
            completed_at: null,
            result: null,
            note: null,
          });
        break;
      case "removeItem":
        for (const s of next.sections) s.items = s.items.filter((i) => i.id !== op.itemId);
        break;
    }
  }
  return next;
}
