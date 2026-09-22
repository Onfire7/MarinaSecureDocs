import { describe, expect, it } from "vitest";
import { toUploadRow } from "./uploadShape";

// The device's SQLite has three column types, so jsonb and Postgres arrays
// live there as TEXT. Uploaded as text they arrive wrong: a jsonb column
// stores the text as a JSON *string* ("{\"type\":…}"), and an array column
// refuses it outright. Every checklist answer saved after the move to
// PowerSync went in double-encoded this way.
const STRUCTURED = {
  checklist_instance_items: ["result"],
  roles: ["allow", "deny"],
};

const ANSWER = { type: "meter_reading", assetId: "0a6cfa20", value: 123057 };

describe("toUploadRow", () => {
  it("uploads a JSON column as an object, not a string", () => {
    const row = toUploadRow(
      "checklist_instance_items",
      { result: JSON.stringify(ANSWER), note: null },
      STRUCTURED,
    );
    expect(row).toEqual({ result: ANSWER, note: null });
  });

  it("uploads an array column as an array", () => {
    const row = toUploadRow("roles", { allow: '["view_owner","view_lease"]' }, STRUCTURED);
    expect(row).toEqual({ allow: ["view_owner", "view_lease"] });
  });

  it("leaves a text column that happens to hold JSON alone", () => {
    // A guard may well type braces into a note. Only columns Postgres itself
    // declares structured are converted.
    const row = toUploadRow(
      "checklist_instance_items",
      { note: '{"not":"ours"}' },
      STRUCTURED,
    );
    expect(row).toEqual({ note: '{"not":"ours"}' });
  });

  it("passes null through untouched", () => {
    // Clearing an answer.
    expect(toUploadRow("checklist_instance_items", { result: null }, STRUCTURED)).toEqual({
      result: null,
    });
  });

  it("sends unparseable text as it is rather than failing the upload", () => {
    // Throwing here would wedge the queue behind one bad value. Postgres can
    // refuse it, and the refusal is then recorded like any other.
    expect(toUploadRow("checklist_instance_items", { result: "{oops" }, STRUCTURED)).toEqual({
      result: "{oops",
    });
  });

  it("unwraps a value that was double-encoded on the device", () => {
    const twice = JSON.stringify(JSON.stringify(ANSWER));
    expect(toUploadRow("checklist_instance_items", { result: twice }, STRUCTURED)).toEqual({
      result: ANSWER,
    });
  });

  it("passes a table with no structured columns straight through", () => {
    const data = { name: "Dock A" };
    expect(toUploadRow("locations", data, STRUCTURED)).toEqual(data);
    expect(toUploadRow("locations", undefined, STRUCTURED)).toEqual({});
  });
});
