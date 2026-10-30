import { describe, expect, it } from "vitest";
import { shiftReportEmail } from "./shiftReportEmail";
import type { ShiftReportDoc } from "./shiftReportDoc";

// Test 6 of the approved list for the Shift Report (2026-10-21).

const doc: ShiftReportDoc = {
  version: 1,
  marinaName: "Harbor Point",
  shift: { id: "s", guardId: "g", guardName: "Dana Ruiz", startedAt: "2026-10-20T22:00:00.000Z", endedAt: "2026-10-21T06:00:00.000Z", endedBy: { kind: "button" } },
  note: "Quiet night apart from the truck.",
  checkIns: 21,
  checklists: [{ id: "c", name: "Dock Walk", done: 14, total: 14, completedAt: null, dueBy: null, previousShiftItems: 0 }],
  attention: Array.from({ length: 23 }, (_, i) => ({
    kind: "manualCheckin",
    tone: "warn" as const,
    where: `Dock ${i}`,
    at: i % 2 ? "2026-10-21T03:20:00.000Z" : null,
    values: { checkpoint: `CP ${i}`, reason: "No tag" },
  })),
  incidents: [],
  tickets: [],
  notes: [],
  vehicles: [],
  locations: [],
};

// A translator that shows its key and values, so the test reads the shape.
const t = (key: string, values: Record<string, string | number> = {}) =>
  `${key}${Object.keys(values).length ? "{" + Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",") + "}" : ""}`;
const format = { day: () => "Tue Oct 20" };

describe("shiftReportEmail", () => {
  const email = shiftReportEmail(doc, "https://beta2.marinasecure.com/r/shift/s", t, format);

  it("gives the subject its guard and day, without the shift's times", () => {
    expect(email.subject).toBe("email.subject{guard=Dana Ruiz,day=Tue Oct 20}");
  });

  it("opens with the summary, quotes the note, lists every attention line, then the link, with no greeting", () => {
    const lines = email.body.split("\n");
    expect(lines[0]).toMatch(/^summary\.checklists\{guard=Dana/);
    expect(lines).toContain("“Quiet night apart from the truck.”");
    expect(lines.filter((l) => l.startsWith("- ")).length).toBe(23);
    expect(lines).toContain("- Dock 1: attention.manualCheckin{checkpoint=CP 1,reason=No tag}");
    expect(lines).toContain("https://beta2.marinasecure.com/r/shift/s");
    // Ends on the link: no times on the attention lines, no "ask the marina" line.
    expect(lines.at(-1)).toBe("https://beta2.marinasecure.com/r/shift/s");
    expect(email.body).not.toMatch(/\(\d\d:\d\d\)/);
    expect(email.body).not.toMatch(/^(Hi|Hello|Dear)/m);
  });

  it("leaves the note out when there is none", () => {
    const body = shiftReportEmail({ ...doc, note: null, attention: [] }, "L", t, format).body;
    expect(body).not.toContain("“");
    expect(body).not.toContain("email.attentionHeading");
  });
});
