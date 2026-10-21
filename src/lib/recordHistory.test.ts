import { describe, expect, it } from "vitest";
import { describeUpdate, isChange, mergeTimeline, type AddendumLike, type UpdateLike } from "./recordHistory";

// Tests 2-4 of the approved list for Ticket Updates and Incident Updates
// (2026-10-21).

const upd = (over: Partial<UpdateLike>): UpdateLike => ({
  id: "u",
  kind: "status",
  from_value: "Open",
  to_value: "Resolved",
  body: null,
  created_at: "2026-10-21T09:41:00.000Z",
  author_name: "Luis Ortega",
  ...over,
});
const add = (over: Partial<AddendumLike>): AddendumLike => ({
  id: "a",
  body: "Truck belongs to the B-22 slip holder's son.",
  created_at: "2026-10-21T07:31:00.000Z",
  author_name: "Mark Ellis",
  ...over,
});

describe("mergeTimeline (test 2)", () => {
  it("interleaves addenda and updates by time, oldest first", () => {
    const out = mergeTimeline(
      [add({ id: "a2", created_at: "2026-10-21T09:40:00.000Z" }), add({ id: "a1" })],
      [upd({ id: "u1" }), upd({ id: "u0", kind: "assignee", created_at: "2026-10-21T07:05:00.000Z" })],
    );
    expect(out.map((e) => e.row.id)).toEqual(["u0", "a1", "a2", "u1"]);
    expect(out.map((e) => e.kind)).toEqual(["update", "addendum", "addendum", "update"]);
  });

  it("keeps equal moments in input order, addenda first", () => {
    const at = "2026-10-21T09:41:00.000Z";
    const out = mergeTimeline(
      [add({ id: "a1", created_at: at }), add({ id: "a2", created_at: at })],
      [upd({ id: "u1", created_at: at }), upd({ id: "u2", created_at: at })],
    );
    expect(out.map((e) => e.row.id)).toEqual(["a1", "a2", "u1", "u2"]);
  });
});

describe("describeUpdate (test 3)", () => {
  it("names each kind as a key with the values the sentence needs", () => {
    expect(describeUpdate(upd({}))).toEqual({ key: "timeline.status", values: { from: "Open", to: "Resolved" } });
    expect(describeUpdate(upd({ kind: "priority", from_value: "Medium", to_value: "High" }))).toEqual({
      key: "timeline.priority",
      values: { from: "Medium", to: "High" },
    });
    expect(describeUpdate(upd({ kind: "assignee", from_value: null, to_value: "Luis Ortega" }))).toEqual({
      key: "timeline.assignee",
      values: { to: "Luis Ortega" },
    });
    expect(describeUpdate(upd({ kind: "created", from_value: null, to_value: null, author_name: "Dana Ruiz" }))).toEqual({
      key: "timeline.created",
      values: { name: "Dana Ruiz" },
    });
    expect(describeUpdate(upd({ kind: "created", from_value: null, to_value: "a checklist item", author_name: "Dana Ruiz" }))).toEqual({
      key: "timeline.createdVia",
      values: { name: "Dana Ruiz", origin: "a checklist item" },
    });
    expect(describeUpdate(upd({ kind: "comment", from_value: null, to_value: null, body: "Strike plate was bent." }))).toEqual({
      key: "timeline.comment",
      values: { body: "Strike plate was bent." },
    });
  });

  it("never throws on a kind it does not know", () => {
    expect(describeUpdate(upd({ kind: "escalated" })).key).toBe("timeline.unknown");
  });
});

describe("isChange (test 4)", () => {
  it("reports choosing the current value as no change, and treats null and undefined alike", () => {
    expect(isChange("open", "open")).toBe(false);
    expect(isChange(null, undefined)).toBe(false);
    expect(isChange("open", "resolved")).toBe(true);
    expect(isChange(null, "someone")).toBe(true);
  });
});
