import { describe, expect, it } from "vitest";
import {
  checklistsInShift,
  compileShiftReport,
  summaryFacts,
  updatesSince,
  worstMark,
  type CompileInputs,
  type InInstance,
  type InItem,
  type InSection,
} from "./shiftReportDoc";
import type { VehicleUse } from "./shiftReport";

// Tests 1-5 and 7 of the approved list for the Shift Report (2026-10-21).

const T = (hhmm: string, day = 20) => `2026-10-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`;
const START = T("22:00");
const END = T("06:00", 21);

const base = (): CompileInputs => ({
  marinaName: "Harbor Point",
  shift: { id: "shift", guard_id: "dana", guard_name: "Dana Ruiz", started_at: START, ended_at: END, end_of_shift_checklist_id: null },
  checkIns: [],
  checkpoints: [
    { id: "cp-a", name: "A Dock head", location_id: "a" },
    { id: "cp-b", name: "End of B Dock", location_id: "b" },
    { id: "cp-x", name: "Boatyard Gate", location_id: "yard" },
  ],
  locations: [
    { id: "marina", name: "Marina", parent_id: null },
    { id: "a", name: "A Dock", parent_id: "marina" },
    { id: "b", name: "B Dock", parent_id: "marina" },
    { id: "yard", name: "Boatyard", parent_id: "marina" },
    { id: "loop", name: "Campground Loop", parent_id: "camp" },
    { id: "camp", name: "Campgrounds", parent_id: "marina" },
  ],
  instances: [{ id: "walk", template_name: "Dock Walk", status: "in_progress", created_at: T("22:05"), completed_at: null, due_by: null }],
  sections: [
    { id: "s-a", instance_id: "walk", template_section_id: "ts-a", label: "A Dock", location_id: "a", due_by: null },
    { id: "s-b", instance_id: "walk", template_section_id: "ts-b", label: "B Dock", location_id: "b", due_by: null },
  ],
  items: [],
  sectionCheckpoints: [
    { section_id: "ts-a", checkpoint_id: "cp-a" },
    { section_id: "ts-b", checkpoint_id: "cp-b" },
  ],
  incidents: [],
  tickets: [],
  notes: [],
  vehicles: [],
});

const simple = (id: string, section_id: string, label: string, completed_at: string | null): InItem => ({
  id,
  section_id,
  type: "simple_check",
  label,
  completed_at,
  result: completed_at ? JSON.stringify({ type: "simple_check", completedAt: 1 }) : null,
  note: null,
});

describe("expected checkpoints (test 1)", () => {
  it("counts a visit at an expected checkpoint, marks the unvisited one missed, and shows an unexpected one as such", () => {
    const input = base();
    input.checkIns = [
      { id: "ci-1", checkpoint_id: "cp-a", checkpoint_name: "A Dock head", timestamp: T("22:31"), method: "scan", reason: null, within_radius: 1 },
      { id: "ci-2", checkpoint_id: "cp-x", checkpoint_name: "Boatyard Gate", timestamp: T("01:50", 21), method: "scan", reason: null, within_radius: 1 },
    ];
    const doc = compileShiftReport(input);
    expect(doc.checkIns).toEqual({ done: 1, expected: 2, extra: 1 });
    const b = doc.locations.find((l) => l.name === "B Dock")!;
    expect(b.items.map((i) => [i.kind, i.mark, i.result.key])).toEqual([["checkin", "missed", "notVisited"]]);
    const yard = doc.locations.find((l) => l.name === "Boatyard")!;
    expect(yard.items[0].notExpected).toBe(true);
    expect(yard.checkIns).toEqual({ visited: 0, expected: 0 });
    expect(doc.attention.map((a) => a.kind)).toEqual(["missedCheckin"]);
    expect(doc.attention[0].values.checkpoint).toBe("End of B Dock");
    expect(doc.attention[0].checklistId).toBe("walk");
  });
});

describe("which checklists belong (test 2)", () => {
  const window = { start: Date.parse(START), end: Date.parse(END) };
  const inst = (id: string, created_at: string | null): InInstance => ({ id, template_name: id, status: "in_progress", created_at, completed_at: null, due_by: null });
  const sec = (id: string, instance_id: string, due_by: string | null = null): InSection => ({ id, instance_id, template_section_id: null, label: id, location_id: null, due_by });

  it("includes a checklist created in the window, one with a section due in it, and one answered in it", () => {
    const belongs = checklistsInShift(
      [inst("created", T("23:00")), inst("due", T("12:00", 19)), inst("answered", T("12:00", 19)), inst("other", T("12:00", 19))],
      [sec("s1", "due", T("03:00", 21)), sec("s2", "answered"), sec("s3", "other")],
      [simple("i1", "s2", "x", T("02:00", 21)), simple("i2", "s3", "y", T("13:00", 19))],
      window,
    );
    expect(belongs.map((b) => b.id)).toEqual(["created", "due", "answered"]);
  });

  it("shows only this shift's items, counts the previous shift's, and marks what is still open as missed", () => {
    const input = base();
    input.instances = [inst("carried", T("12:00", 19))];
    input.sections = [sec("s-c", "carried")];
    input.items = [
      simple("old", "s-c", "Done yesterday", T("13:00", 19)),
      simple("mine", "s-c", "Done tonight", T("23:30")),
      simple("open", "s-c", "Never done", null),
      simple("late", "s-c", "Done after the shift", T("09:00", 21)),
    ];
    input.sectionCheckpoints = [];
    const doc = compileShiftReport(input);
    expect(doc.checklists).toEqual([{ id: "carried", name: "carried", done: 1, total: 3, completedAt: null, dueBy: null, previousShiftItems: 1 }]);
    const card = doc.locations[0];
    expect(card.items.map((i) => [i.label, i.mark])).toEqual([["Done tonight", "ok"], ["Never done", "missed"], ["Done after the shift", "missed"]]);
    expect(doc.attention.map((a) => a.kind)).toEqual(["unfinished"]);
  });
});

describe("needs attention (test 3)", () => {
  it("produces one line per qualifying event, in time order, with its place, and none for routine items", () => {
    const input = base();
    input.checkIns = [
      { id: "ci-a", checkpoint_id: "cp-a", checkpoint_name: "A Dock head", timestamp: T("22:31"), method: "scan", reason: null, within_radius: 1 },
      { id: "ci-b", checkpoint_id: "cp-b", checkpoint_name: "End of B Dock", timestamp: T("22:52"), method: "manual", reason: "Tag cracked", within_radius: 1 },
      { id: "ci-x", checkpoint_id: "cp-x", checkpoint_name: "Boatyard Gate", timestamp: T("02:15", 21), method: "scan", reason: null, within_radius: 0 },
    ];
    input.items = [
      simple("ok", "s-a", "Cords out of the water", T("22:39")),
      { id: "door", section_id: "s-b", type: "door_check", label: "Rear door", completed_at: T("23:18"), note: null,
        result: JSON.stringify({ type: "door_check", expected: "locked", initialState: "unlocked", finalState: "locked" }) },
      { id: "verify", section_id: "s-b", type: "verify_task", label: "Dock lights replaced", completed_at: T("00:18", 21), note: null,
        result: JSON.stringify({ type: "verify_task", outcome: "rejected_ticket", reason: "Both still out." }) },
      simple("open", "s-a", "Spill kit", null),
    ];
    input.incidents = [{ id: "inc", title: "Unattended pickup", type_name: "Security", target_label: "Boatyard", created_at: T("01:52", 21), status_name: "Open", status_is_terminal: 0, details: null }];
    input.vehicles = [
      vehicle({ name: "Patrol Truck", note: "Mud on the seats", fuelBack: 1, end: { kind: "in", at: T("05:58", 21) } }),
      vehicle({ name: "Golf Cart", keptReason: "Charger at the shop", end: { kind: "kept", at: T("05:59", 21) }, statuses: [{ at: T("02:12", 21), name: "Out of Service", note: "Flat" }] }),
    ];
    const doc = compileShiftReport(input);
    expect(doc.attention.map((a) => a.kind)).toEqual([
      "manualCheckin",
      "doorFound",
      "verifyRejected",
      "incident",
      "vehicleOutOfService",
      "outsideRadius",
      "vehicleNote",
      "vehicleLowFuel",
      "vehicleKept",
      "unfinished",
    ]);
    expect(doc.attention[1].where).toBe("Marina › B Dock");
    expect(doc.attention[1].values).toEqual({ door: "Rear door", found: "Unlocked", expected: "Locked", left: "Locked" });
    expect(doc.attention.at(-1)!.values).toMatchObject({ name: "Dock Walk", done: "3", total: "4" });
    expect(doc.attention.filter((a) => a.values.door === "Cords out of the water")).toHaveLength(0);
  });
});

function vehicle(over: Partial<VehicleUse>): VehicleUse {
  return {
    assetId: over.name ?? "v",
    name: "Vehicle",
    meterType: "mileage",
    checkoutId: "co",
    out: T("22:05"),
    keptFromPrevious: false,
    end: { kind: "in", at: T("05:58", 21) },
    odometerOut: 48000,
    odometerEnd: 48042,
    distance: 42,
    fuelBack: 2,
    note: null,
    keptReason: null,
    fills: [],
    statusChecks: [],
    statuses: [],
    readings: [],
    raised: [],
    firstAt: Date.parse(T("22:05")),
    ...over,
  };
}

describe("locations in tree order (test 4)", () => {
  it("orders parent before child and siblings by name, interleaves items by time, and puts section-less items last", () => {
    const input = base();
    input.sections.push(
      { id: "s-loop", instance_id: "walk", template_section_id: null, label: "Loop", location_id: "loop", due_by: null },
      { id: "s-camp", instance_id: "walk", template_section_id: null, label: "Camp", location_id: "camp", due_by: null },
      { id: "s-none", instance_id: "walk", template_section_id: null, label: "Closing", location_id: null, due_by: null },
    );
    input.items = [
      simple("l1", "s-loop", "Loop item", T("02:00", 21)),
      simple("c1", "s-camp", "Camp item", T("23:58")),
      simple("n1", "s-none", "Keys in the box", T("06:00", 21)),
      simple("a2", "s-a", "After the scan", T("22:40")),
      simple("a1", "s-a", "Before the scan", T("22:20")),
    ];
    input.checkIns = [{ id: "ci-a", checkpoint_id: "cp-a", checkpoint_name: "A Dock head", timestamp: T("22:31"), method: "scan", reason: null, within_radius: 1 }];
    const doc = compileShiftReport(input);
    expect(doc.locations.map((l) => l.name)).toEqual(["A Dock", "B Dock", "Campgrounds", "Campground Loop", "Dock Walk"]);
    expect(doc.locations[0].items.map((i) => i.label)).toEqual(["Before the scan", "A Dock head", "After the scan"]);
    expect(doc.locations[3].path).toEqual(["Marina", "Campgrounds"]);
    expect(doc.locations.at(-1)!.id).toBeNull();
    expect(worstMark(doc.locations[0].items)).toBe("ok");
    expect(worstMark(doc.locations[1].items)).toBe("missed");
  });
});

describe("summary sentences (test 5)", () => {
  it("says check-ins, raised records, one line per vehicle driven, and the attention count", () => {
    const input = base();
    input.vehicles = [
      vehicle({ name: "Patrol Truck" }),
      vehicle({ name: "Golf Cart", end: { kind: "still_out", at: null }, fuelBack: null }),
      vehicle({ name: "Van", end: { kind: "kept", at: T("06:00", 21) }, keptReason: "r" }),
      vehicle({ name: "No meter", distance: null, odometerOut: null }),
    ];
    const facts = summaryFacts(compileShiftReport(input));
    expect(facts.map((f) => f.key)).toEqual(["checkIns", "raised", "droveReturned", "droveStillOut", "droveKept", "attention"]);
    // A checklist with nothing in it counts as complete.
    expect(facts[0].values).toEqual({ guard: "Dana", done: "0", expected: "2", complete: "1", total: "1" });
    expect(facts[2].values).toMatchObject({ vehicle: "Patrol Truck", distance: "42", fuel: "2" });
  });
});

describe("updates since End of Shift (test 7)", () => {
  it("keeps only what came after ended_at, grouped under its record by time, with the status now only when it moved", () => {
    const input = base();
    input.incidents = [{ id: "inc", title: "x", type_name: null, target_label: null, created_at: T("01:00", 21), status_name: "Open", status_is_terminal: 0, details: null }];
    input.tickets = [{ id: "tkt", title: "y", priority: "medium", target_label: null, created_at: T("01:10", 21), status_name: "Open", assignee_name: null, description: null, origin: null }];
    const doc = compileShiftReport(input);
    const since = updatesSince(doc, END, {
      incidentComments: [
        { id: "c-before", incident_id: "inc", body: "before", created_at: T("02:00", 21), author_name: "Dana" },
        { id: "c-after", incident_id: "inc", body: "after", created_at: T("07:31", 21), author_name: "Mark" },
      ],
      incidentUpdates: [{ id: "u-after", incident_id: "inc", kind: "status", from_value: "Open", to_value: "Closed", created_at: T("07:33", 21), author_name: "Mark" }],
      ticketUpdates: [
        { id: "t-created", ticket_id: "tkt", kind: "created", from_value: null, to_value: null, body: null, created_at: T("01:10", 21), author_name: "Dana" },
        { id: "t-comment", ticket_id: "tkt", kind: "comment", from_value: null, to_value: null, body: "Fixed", created_at: T("09:40", 21), author_name: "Luis" },
      ],
    });
    expect(since.incidents.inc.rows.map((r) => r.id)).toEqual(["c-after", "u-after"]);
    expect(since.incidents.inc.now).toBe("Closed");
    expect(since.tickets.tkt.rows.map((r) => r.id)).toEqual(["t-comment"]);
    expect(since.tickets.tkt.now).toBeNull();
    expect(updatesSince(doc, null, { incidentComments: [], incidentUpdates: [], ticketUpdates: [] }).incidents.inc.rows).toEqual([]);
  });
});
