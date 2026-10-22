import { describe, expect, it } from "vitest";
import { checklistCreatedSummary } from "./checklistReason";

// The Activity Log line written when a checklist is created. Stored history
// must read exactly as it did when the reason was English stitched onto the
// template name, so each kind is pinned to that wording.
describe("checklistCreatedSummary", () => {
  const cases: [Parameters<typeof checklistCreatedSummary>[1], string][] = [
    [{ kind: "clockIn" }, "Dock Walks created by clock-in"],
    [{ kind: "clockOut" }, "Dock Walks created by clock-out"],
    [{ kind: "schedule" }, "Dock Walks created by its recurring schedule"],
    [{ kind: "manual", name: "Sean" }, "Dock Walks created by Sean starting it manually"],
    [{ kind: "manual", name: null }, "Dock Walks created by a user starting it manually"],
    [{ kind: "locationCheck", label: "BH01" }, "Dock Walks created by a location check on BH01"],
  ];
  it.each(cases)("%o", (reason, expected) => {
    expect(checklistCreatedSummary("Dock Walks", reason)).toBe(expected);
  });
});
