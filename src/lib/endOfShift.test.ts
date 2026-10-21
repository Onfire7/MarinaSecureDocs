import { describe, expect, it } from "vitest";
import {
  clockOutBlockedReason,
  endShiftBlockedReason,
  nextEndOfShiftStep,
  pinEndShiftLast,
  type ShiftChecklist,
  type TemplateShape,
} from "./endOfShift";

// Tests 1–7 of the approved list for the End Shift Item
// (src/pages/checklists/ActiveChecklistPage.spec.md § Ending the shift,
// src/pages/admin/AdminChecklistTemplatesPage.spec.md § End Shift Items).

const SHIFT_START = "2026-10-20T22:00:00.000Z";
const at = (hhmm: string) => `2026-10-20T${hhmm}:00.000Z`;

const open = (id: string, createdAt: string, endShift: "unanswered" | "answered" | "none" = "unanswered"): ShiftChecklist => ({
  id,
  name: `Checklist ${id}`,
  created_at: createdAt,
  status: "in_progress",
  endShift,
});

const base = {
  shiftStartedAt: SHIFT_START,
  checklists: [] as ShiftChecklist[],
  clockOutTemplateReady: false,
  endOfShiftChecklist: null as { id: string; status: string } | null,
};

describe("nextEndOfShiftStep", () => {
  // 1
  it("sends the guard to finish an open checklist with an unanswered End Shift Item, the oldest first", () => {
    const step = nextEndOfShiftStep({
      ...base,
      checklists: [open("later", at("23:30")), open("earlier", at("22:15"))],
      clockOutTemplateReady: true,
    });
    expect(step).toEqual({ kind: "finish", checklistId: "earlier", name: "Checklist earlier" });
  });

  // 2
  it("ignores End Shift Items from before the shift, on submitted checklists, already answered, or excluded", () => {
    const step = nextEndOfShiftStep({
      ...base,
      checklists: [
        open("before", "2026-10-20T21:59:00.000Z"),
        { ...open("submitted", at("22:30")), status: "complete" },
        open("answered", at("22:31"), "answered"),
        open("plain", at("22:32"), "none"),
        { ...open("undated", at("22:33")), created_at: null },
        open("just-submitted", at("22:34")),
      ],
      excludeChecklistId: "just-submitted",
    });
    expect(step).toEqual({ kind: "review" });
  });

  // 3
  it("creates the End of Shift Checklist when one is due and none is linked, and reopens a linked unfinished one", () => {
    expect(nextEndOfShiftStep({ ...base, clockOutTemplateReady: true })).toEqual({
      kind: "end_of_shift_checklist",
      existingId: null,
    });
    expect(
      nextEndOfShiftStep({
        ...base,
        clockOutTemplateReady: true,
        endOfShiftChecklist: { id: "eos", status: "in_progress" },
      }),
    ).toEqual({ kind: "end_of_shift_checklist", existingId: "eos" });
    // Linked and unfinished wins even if the template has since lost its work.
    expect(
      nextEndOfShiftStep({ ...base, endOfShiftChecklist: { id: "eos", status: "not_started" } }),
    ).toEqual({ kind: "end_of_shift_checklist", existingId: "eos" });
  });

  // 4
  it("goes to the review when the End of Shift Checklist is done, or none is due", () => {
    expect(
      nextEndOfShiftStep({
        ...base,
        clockOutTemplateReady: true,
        endOfShiftChecklist: { id: "eos", status: "complete" },
      }),
    ).toEqual({ kind: "review" });
    // No Clock Out template, or one with nothing to do right now, reads the same.
    expect(nextEndOfShiftStep(base)).toEqual({ kind: "review" });
  });
});

const section = (id: string, trigger_type: string, types: string[], is_active = 1) => ({
  id,
  trigger_type,
  is_active,
  items: types.map((type) => ({ type })),
});

const template = (trigger_type: string, sections: TemplateShape["sections"]): TemplateShape => ({
  trigger_type,
  sections,
});

describe("nextEndOfShiftStep — vehicles still out (Fleet Vehicle Item test 6)", () => {
  const vehicle = (checkoutId: string, timeOut: string, kept = 0) => ({
    checkoutId,
    name: `Vehicle ${checkoutId}`,
    time_out: timeOut,
    kept_after_shift: kept,
  });

  it("asks about a vehicle still held after the End of Shift Checklist and before the review, earliest first", () => {
    expect(
      nextEndOfShiftStep({
        ...base,
        clockOutTemplateReady: true,
        heldVehicles: [vehicle("v2", at("23:00"))],
      }).kind,
    ).toBe("end_of_shift_checklist");
    expect(
      nextEndOfShiftStep({
        ...base,
        heldVehicles: [vehicle("later", at("23:00")), vehicle("earlier", at("22:30"))],
      }),
    ).toEqual({ kind: "vehicle", checkoutId: "earlier", name: "Vehicle earlier" });
  });

  it("does not ask again about a vehicle kept during this shift", () => {
    expect(
      nextEndOfShiftStep({ ...base, heldVehicles: [vehicle("kept", at("23:59"), 1)] }).kind,
    ).toBe("review");
  });

  it("asks about a vehicle kept from an earlier shift", () => {
    expect(
      nextEndOfShiftStep({ ...base, heldVehicles: [vehicle("old", "2026-10-20T06:00:00.000Z", 1)] }),
    ).toEqual({ kind: "vehicle", checkoutId: "old", name: "Vehicle old" });
  });

  it("goes to the review holding nothing", () => {
    expect(nextEndOfShiftStep({ ...base, heldVehicles: [] }).kind).toBe("review");
  });
});

describe("endShiftBlockedReason", () => {
  // 5
  it("allows End Shift only in the last section of a non-Clock-Out template that has none, made with the checklist", () => {
    const ok = template("manual", [section("a", "checkpoint", ["simple_check"]), section("b", "manual", ["simple_check"])]);
    expect(endShiftBlockedReason(ok, "b")).toBeNull();

    const reasons = [
      endShiftBlockedReason(template("manual", [section("a", "manual", ["simple_check", "end_shift"])]), "a"),
      endShiftBlockedReason(template("clock_out", [section("a", "manual", ["simple_check"])]), "a"),
      endShiftBlockedReason(template("manual", [section("a", "manual", []), section("b", "checkpoint", [])]), "b"),
      endShiftBlockedReason(template("manual", [section("a", "manual", []), section("b", "manual", [], 0)]), "b"),
      endShiftBlockedReason(ok, "a"),
    ];
    for (const r of reasons) expect(r).toEqual(expect.any(String));
    // Each rule says its own reason, not one catch-all.
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});

describe("clockOutBlockedReason", () => {
  // 6
  it("blocks Clock Out on a template with an End Shift Item, and only then", () => {
    expect(clockOutBlockedReason(template("manual", [section("a", "manual", ["end_shift"])]))).toEqual(
      expect.any(String),
    );
    expect(clockOutBlockedReason(template("manual", [section("a", "manual", ["simple_check"])]))).toBeNull();
  });
});

describe("pinEndShiftLast", () => {
  // 7
  it("keeps the pinned row last whatever order it is handed, and keeps the rest in order", () => {
    const isPinned = (id: string) => id === "end";
    expect(pinEndShiftLast(["a", "b", "end"], isPinned)).toEqual(["a", "b", "end"]);
    // A drop above it, and a new row appended after it.
    expect(pinEndShiftLast(["a", "end", "b"], isPinned)).toEqual(["a", "b", "end"]);
    expect(pinEndShiftLast(["end", "b", "a", "c"], isPinned)).toEqual(["b", "a", "c", "end"]);
    expect(pinEndShiftLast(["a", "b"], isPinned)).toEqual(["a", "b"]);
  });
});
