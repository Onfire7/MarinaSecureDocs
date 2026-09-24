import { describe, expect, it } from "vitest";
import {
  attention,
  removedNote,
  describeProposal,
  itemRows,
  narrative,
  needsAttention,
  summarize,
  toCsv,
  wideHeaders,
  wideRows,
  wideTable,
  uniformValue,
  type AuditReport,
  type ReportTarget,
} from "./auditReport";

// The approved list, 2026-09-23: tests 1-8 of docs/audits.md § Sharing the
// results. The fixture is a four-target status audit - two clean, one with
// everything wrong, one not reached - and a small occupancy audit.

const target = (over: Partial<ReportTarget> & { id: string; name: string }): ReportTarget => ({
  locationId: over.id,
  typeName: "Slip",
  area: "BH14",
  state: "audited",
  notAuditedReason: null,
  displacedNote: null,
  finding: { recordedBy: "Alice", recordedAt: "2026-09-20T13:00:00Z", occupied: null, unexpectedOccupancy: false, clearlyMarked: true, mappedCorrectly: true },
  services: [],
  amenities: [],
  attributes: [],
  answers: [],
  proposals: [],
  tickets: [],
  ...over,
});

const statusAudit: AuditReport = {
  audit: {
    id: "a1",
    name: "B Dock status",
    kind: "status",
    status: "closed",
    launchedAt: "2026-09-19T12:00:00Z",
    closedAt: "2026-09-22T12:00:00Z",
    finalizedAt: null,
    includeAttributes: true,
    includeServices: true,
    includeAmenities: true,
    includeMarked: true,
    includeMap: true,
  },
  marinaName: "Grandpappy Point Marina",
  launchedBy: "Alice",
  closedBy: "Alice",
  finalizedBy: null,
  assignees: ["Alice"],
  columns: {
    services: ["Power", "Water"],
    amenities: ["WiFi"],
    attributes: [{ name: "Max boat length", unit: "ft" }, { name: "Access", unit: null }],
    questions: ["Is the pedestal breaker labelled?", "Fire ring condition"],
  },
  targets: [
    target({
      id: "t1",
      name: "BH14-01L",
      services: [
        { name: "Power", present: true, working: true, note: null },
        { name: "Water", present: true, working: true, note: null },
      ],
      amenities: [{ name: "WiFi", present: true, note: null }],
      attributes: [
        { name: "Max boat length", unit: "ft", value: "38", proposed: false },
        { name: "Access", unit: null, value: null, proposed: false },
      ],
      answers: [
        { prompt: "Is the pedestal breaker labelled?", kind: "yes_no", value: true, ticketId: null },
        { prompt: "Fire ring condition", kind: "choice", value: "Good", ticketId: null },
      ],
      proposals: [{ id: "p1", kind: "set_service", structural: false, decision: "approved", reason: null, recordedBy: "Alice", payload: { serviceName: "Water", present: true } }],
    }),
    target({
      id: "t2",
      name: "BH14-01R",
      services: [
        { name: "Power", present: true, working: true, note: null },
        { name: "Water", present: false, working: true, note: null },
      ],
      amenities: [{ name: "WiFi", present: false, note: null }],
      answers: [{ prompt: "Is the pedestal breaker labelled?", kind: "yes_no", value: true, ticketId: null }],
      proposals: [{ id: "p2", kind: "set_attribute", structural: false, decision: "rejected", reason: "measured wrong", recordedBy: "Alice", payload: { attributeName: "Max boat length", attributeUnit: "ft", value: 40, text: null } }],
    }),
    target({
      id: "t3",
      name: "BH14-02L",
      finding: { recordedBy: "Bob", recordedAt: "2026-09-21T09:30:00Z", occupied: null, unexpectedOccupancy: false, clearlyMarked: false, mappedCorrectly: false },
      services: [
        { name: "Power", present: true, working: false, note: "pedestal dead" },
        { name: "Water", present: true, working: true, note: "shared tap" },
      ],
      amenities: [{ name: "WiFi", present: true, note: "weak signal" }],
      attributes: [
        { name: "Max boat length", unit: "ft", value: "35", proposed: true },
        { name: "Access", unit: null, value: "Back-in", proposed: true },
      ],
      answers: [
        { prompt: "Is the pedestal breaker labelled?", kind: "yes_no", value: false, ticketId: "k1" },
        { prompt: "Fire ring condition", kind: "choice", value: "Rusted", ticketId: null },
      ],
      proposals: [
        { id: "p3", kind: "move_placement", structural: true, decision: null, reason: null, recordedBy: "Bob", payload: {} },
        { id: "p4", kind: "set_attribute", structural: false, decision: "approved", reason: null, recordedBy: "Bob", payload: { attributeName: "Access", value: null, text: "Back-in" } },
      ],
      tickets: [
        { id: "k1", title: "Label pedestal breaker at BH14-02L", priority: "medium", status: "Open", open: true },
        { id: "k2", title: "Pedestal dead at BH14-02L", priority: "high", status: "Complete", open: false },
      ],
    }),
    target({ id: "t4", name: "BH14-02R", state: "not_audited", notAuditedReason: "closed early", finding: null }),
  ],
  newLocationProposals: [],
  asOf: "2026-09-23T10:00:00Z",
};

const occupancyAudit: AuditReport = {
  ...statusAudit,
  audit: { ...statusAudit.audit, id: "a2", name: "B Dock occupancy", kind: "occupancy", status: "finalized", finalizedAt: "2026-09-23T09:00:00Z" },
  columns: { services: [], amenities: [], attributes: [], questions: ["Dock lines in good condition?"] },
  targets: [
    target({ id: "o1", name: "Bh04-01L", finding: { recordedBy: "Alice", recordedAt: "2026-09-11T10:00:00Z", occupied: true, unexpectedOccupancy: false, clearlyMarked: null, mappedCorrectly: null }, answers: [{ prompt: "Dock lines in good condition?", kind: "yes_no", value: true, ticketId: null }] }),
    target({ id: "o2", name: "Bh04-01R", finding: { recordedBy: "Alice", recordedAt: "2026-09-11T10:10:00Z", occupied: true, unexpectedOccupancy: true, clearlyMarked: null, mappedCorrectly: null }, answers: [{ prompt: "Dock lines in good condition?", kind: "yes_no", value: false, ticketId: null }] }),
    target({ id: "o3", name: "Bh04-02L", finding: { recordedBy: "Alice", recordedAt: "2026-09-11T10:20:00Z", occupied: false, unexpectedOccupancy: true, clearlyMarked: null, mappedCorrectly: null } }),
    target({ id: "o4", name: "Bh04-02R", finding: { recordedBy: "Alice", recordedAt: "2026-09-11T10:30:00Z", occupied: false, unexpectedOccupancy: false, clearlyMarked: null, mappedCorrectly: null } }),
  ],
};

describe("summarize", () => {
  it("1 · status: coverage, what is broken, marks, decisions and tickets", () => {
    const s = summarize(statusAudit);
    expect(s.coveragePct).toBe(75);
    expect(s.audited).toBe(3);
    expect(s.notAudited).toBe(1);
    expect(s.broken).toEqual([{ service: "Power", location: "BH14-02L", note: "pedestal dead" }]);
    expect(s.services).toEqual([
      { name: "Power", present: 3, absent: 0, broken: 1 },
      { name: "Water", present: 2, absent: 1, broken: 0 },
    ]);
    expect(s.notMarked).toEqual(["BH14-02L"]);
    expect(s.notMapped).toEqual(["BH14-02L"]);
    expect(s.proposals).toEqual({ total: 4, approved: 2, rejected: 1, undecided: 1, structural: 1 });
    expect(s.tickets).toEqual({ total: 2, open: 1 });
    expect(s.questions[0]).toEqual({ prompt: "Is the pedestal breaker labelled?", kind: "yes_no", yes: 2, no: 1, tally: {} });
    expect(s.questions[1].tally).toEqual({ Good: 1, Rusted: 1 });
    expect(s.auditors).toEqual(["Alice", "Bob"]);
  });
  it("2 · occupancy: occupied, vacant and the unexpected list", () => {
    const s = summarize(occupancyAudit);
    expect(s.occupied).toBe(2);
    expect(s.vacant).toBe(2);
    expect(s.unexpected).toEqual([
      { location: "Bh04-01R", occupied: true },
      { location: "Bh04-02L", occupied: false },
    ]);
    expect(s.coveragePct).toBe(100);
  });
});

describe("narrative", () => {
  it("3 · status sentences, with the right plurals", () => {
    const s = summarize(statusAudit);
    expect(narrative(statusAudit, s)).toEqual([
      "3 of 4 locations were audited by Alice and Bob between Sep 20, 2026 and Sep 21, 2026; 1 was not reached before the audit closed.",
      "1 service was found not working: Power at 1 location.",
      "Signage and mapping: 1 not clearly marked and 1 placed wrongly on the map.",
      "4 changes proposed: 2 approved, 1 rejected and 1 still to decide, 1 structural.",
      "2 tickets raised, 1 still open.",
    ]);
  });
  it("3c · findings all on one day say 'on', not 'between … and …'", () => {
    const sameDay = {
      ...statusAudit,
      targets: statusAudit.targets.map((t) => ({ ...t, finding: t.finding && { ...t.finding, recordedAt: "2026-09-20T15:00:00Z" } })),
    };
    expect(narrative(sameDay, summarize(sameDay))[0]).toMatch(/audited by Alice and Bob on Sep 20, 2026; 1 was not reached/);
  });
  it("3b · an open audit's not-reached count carries no 'before the audit closed'", () => {
    const open = { ...statusAudit, audit: { ...statusAudit.audit, status: "open" as const } };
    expect(narrative(open, summarize(open))[0]).toMatch(/1 was not reached\.$/);
  });
  it("3d · an open audit counts what is still to visit", () => {
    const open = {
      ...statusAudit,
      audit: { ...statusAudit.audit, status: "open" as const },
      targets: statusAudit.targets.map((t) => (t.state === "not_audited" ? { ...t, state: "pending" as const, notAuditedReason: null } : t)),
    };
    expect(narrative(open, summarize(open))[0]).toBe("3 of 4 locations were audited by Alice and Bob between Sep 20, 2026 and Sep 21, 2026. 1 is still to visit.");
  });
  it("4 · occupancy sentences, and the all-matched branch", () => {
    const s = summarize(occupancyAudit);
    const lines = narrative(occupancyAudit, s);
    expect(lines[1]).toBe("2 occupied, 2 vacant. 2 did not match the lease or reservation on file.");
    expect(lines.some((l) => /unanswered/i.test(l))).toBe(false);
    const matched = {
      ...occupancyAudit,
      targets: occupancyAudit.targets.map((t) => ({ ...t, finding: t.finding && { ...t.finding, unexpectedOccupancy: false } })),
    };
    expect(narrative(matched, summarize(matched))[1]).toBe("2 occupied, 2 vacant. Every one matched what is on file.");
  });
});

describe("attention", () => {
  it("5c · an undecided proposal is not a location that needs attention", () => {
    // t3 carries an undecided move_placement. Every Attribute answer is a
    // Proposal, so counting them here put every location in the list and
    // buried the broken pedestal.
    const undecidedOnly = { ...statusAudit.targets[1], proposals: statusAudit.targets[2].proposals.filter((p) => p.decision === null) };
    expect(attention(undecidedOnly)).toEqual([]);
    expect(needsAttention(undecidedOnly)).toBe(false);
    expect(attention(statusAudit.targets[2]).some((line) => /undecided|Move on the map/.test(line))).toBe(false);
  });
  it("5 · every trigger, in words; a clean target has none", () => {
    expect(attention(statusAudit.targets[2])).toEqual([
      "Power not working - pedestal dead",
      "Water: shared tap",
      "WiFi: weak signal",
      "not clearly marked",
      "wrong on the map",
      "Is the pedestal breaker labelled: No",
      "ticket open: Label pedestal breaker at BH14-02L",
    ]);
    expect(attention(occupancyAudit.targets[1])).toEqual(["occupied, nothing on file", "Dock lines in good condition: No"]);
    expect(attention(occupancyAudit.targets[2])).toEqual(["vacant, but leased or reserved"]);
    expect(attention(statusAudit.targets[0])).toEqual([]);
    expect(needsAttention(statusAudit.targets[0])).toBe(false);
    expect(needsAttention(statusAudit.targets[3])).toBe(false);
  });
  it("5d · a note is a reason to look, wherever it was recorded", () => {
    // Somebody typed it on a phone, in the rain. It was already in the
    // Notes column; a reader should not have to cross-reference two tables.
    const noted: ReportTarget = {
      ...statusAudit.targets[0],
      services: [{ name: "Power", present: true, working: true, note: "pedestal loose" }],
      amenities: [{ name: "Fire pit", present: true, note: "ring cracked" }],
    };
    expect(attention(noted)).toEqual(["Power: pedestal loose", "Fire pit: ring cracked"]);
    expect(needsAttention(noted)).toBe(true);
    // and a not-working service says it once, not twice
    const broken: ReportTarget = { ...noted, services: [{ name: "Power", present: true, working: false, note: "dead" }] };
    expect(attention(broken).filter((l) => /Power/.test(l))).toEqual(["Power not working - dead"]);
  });
  it("5b · a proposal is described from its resolved payload", () => {
    expect(describeProposal(statusAudit.targets[1].proposals[0])).toBe("Max boat length → 40 ft");
    expect(describeProposal(statusAudit.targets[2].proposals[1])).toBe("Access → Back-in");
    expect(describeProposal({ id: "x", kind: "set_attribute", structural: false, decision: null, reason: null, recordedBy: null, payload: { attributeName: "Access", value: null, text: null } })).toBe("Access cleared");
    expect(describeProposal({ id: "x", kind: "create_location", structural: true, decision: null, reason: null, recordedBy: null, payload: { name: "RV101", locationTypeName: "Campsite", parentName: "Loop D" } })).toBe("New location RV101 (Campsite under Loop D)");
    expect(describeProposal({ id: "x", kind: "set_gps", structural: false, decision: null, reason: null, recordedBy: null, payload: {} })).toBe("GPS captured");
  });
});

describe("wide rows", () => {
  it("6 · headers follow what the audit asked, in catalogue order", () => {
    expect(wideHeaders(statusAudit)).toEqual(["Max boat length", "Access", "Power", "Water", "WiFi", "Is the pedestal breaker labelled?", "Fire ring condition", "Marked", "Map"]);
    expect(wideHeaders(occupancyAudit)).toEqual(["Occupied", "Dock lines in good condition?"]);
    const noMap = { ...statusAudit, audit: { ...statusAudit.audit, includeMap: false } };
    expect(wideHeaders(noMap)).not.toContain("Map");
    expect(wideHeaders(noMap)).toContain("Marked");
  });
  it("7 · the cell vocabulary, a not-audited row, and the notes column", () => {
    const rows = wideRows(statusAudit);
    expect(rows[0].cells).toEqual({
      Power: "Working",
      Water: "Working",
      WiFi: "Yes",
      "Max boat length": "38 ft",
      "Access": "-",
      "Is the pedestal breaker labelled?": "Yes",
      "Fire ring condition": "Good",
      Marked: "Yes",
      Map: "Yes",
    });
    expect(rows[1].cells.Water).toBe("Absent");
    expect(rows[1].cells.WiFi).toBe("No");
    expect(rows[2].cells.Power).toBe("Not working");
    expect(rows[2].cells["Max boat length"]).toBe("35 ft *");
    expect(rows[2].cells["Access"]).toBe("Back-in *");
    expect(rows[2].cells["Is the pedestal breaker labelled?"]).toBe("No");
    expect(rows[2].cells.Marked).toBe("No");
    expect(rows[2].notes).toBe("Power: pedestal dead; Water: shared tap; WiFi: weak signal");
    expect(Object.values(rows[3].cells).every((v) => v === "-")).toBe(true);
    expect(rows[3].notes).toBe("not audited · closed early");
    const occ = wideRows(occupancyAudit);
    expect(occ.map((w) => w.cells.Occupied)).toEqual(["Occupied", "Occupied !", "Vacant !", "Vacant"]);
  });
  it("7b · the exported table keeps State as a column even though the page hides it", () => {
    const t = wideTable(statusAudit, wideRows(statusAudit));
    expect(t.headers.slice(0, 5)).toEqual(["Location", "Area", "Type", "State", "Max boat length"]);
    expect(t.rows[3][3]).toBe("not audited");
    expect(t.rows[2][t.headers.indexOf("Changes")]).toBe(2);
  });
  it("7c · item rows: one per thing found, skipping targets with no finding", () => {
    const items = itemRows(statusAudit);
    expect(items.filter((x) => x.location === "BH14-02R")).toHaveLength(0);
    expect(items.filter((x) => x.location === "BH14-02L").map((x) => x.category)).toEqual([
      "Attribute", "Attribute", "Service", "Service", "Amenity", "Question", "Question", "Marked", "Map", "Change", "Ticket", "Ticket",
    ]);
    expect(items.find((x) => x.location === "BH14-02L" && x.item === "Power")).toMatchObject({ result: "Not working", tone: "bad", note: "pedestal dead" });
  });
});

describe("uniformValue", () => {
  it("7d · the one value every row shares, or null", () => {
    expect(uniformValue(statusAudit.targets.map((t) => t.typeName))).toBe("Slip");
    expect(uniformValue(statusAudit.targets.map((t) => t.area))).toBe("BH14");
    expect(uniformValue(["Slip", "Campsite", "Slip"])).toBe(null);
    expect(uniformValue(["Slip", null])).toBe(null);
    expect(uniformValue([])).toBe(null);
  });
});

describe("toCsv", () => {
  it("8 · quotes commas, quotes and newlines; header first; numbers bare", () => {
    expect(toCsv(["a", "b"], [["plain", 3], ['say "hi", now', "two\nlines"]])).toBe('a,b\nplain,3\n"say ""hi"", now","two\nlines"');
  });
});

describe("a filtered document", () => {
  // Test 11 of the list approved 2026-09-24. The filter is applied in the
  // database (docs/audits.md § A link can show less); what this guards is
  // the other half of the promise - that the DERIVED numbers carry the
  // omission too, because every one of them is computed from the document.
  // A reader must not be able to tell the audit ever asked.
  const withoutServices: AuditReport = {
    ...statusAudit,
    audit: { ...statusAudit.audit, includeServices: false },
    columns: { ...statusAudit.columns, services: [] },
    targets: statusAudit.targets.map((t) => ({ ...t, services: [] })),
  };
  it("9c · the summary counts only what the document still contains", () => {
    expect(summarize(statusAudit).broken.length).toBeGreaterThan(0);
    expect(summarize(withoutServices).broken).toEqual([]);
    expect(summarize(withoutServices).services).toEqual([]);
    expect(narrative(withoutServices, summarize(withoutServices)).join(" ")).not.toMatch(/not working/i);
  });
  it("9d · no column, and nothing in Needs attention, to give it away", () => {
    expect(wideHeaders(statusAudit)).toContain("Power");
    expect(wideHeaders(withoutServices)).not.toContain("Power");
    expect(attention(statusAudit.targets[2])).toContain("Power not working - pedestal dead");
    expect(attention({ ...statusAudit.targets[2], services: [] })).not.toContain("Power not working - pedestal dead");
    expect(itemRows(withoutServices).some((r) => r.category === "Service")).toBe(false);
  });
});

describe("a location that has since been removed", () => {
  // Tests 1-3 of the list approved 2026-09-24. A report that lists a
  // retired Location as though it were still there sends somebody to look
  // at something that is gone (docs/audits.md § 6).
  const gone = (over: Partial<ReportTarget> = {}): ReportTarget => ({
    ...statusAudit.targets[0],
    retiredAt: "2026-09-24T10:00:00Z",
    ...over,
  });
  const retirement = (decision: "approved" | "rejected" | null) => ({
    id: "pz", kind: "retire_location" as const, structural: true, decision, reason: null, recordedBy: "Bob", payload: {},
  });

  it("12 · says who removed it, and says nothing about one still standing", () => {
    expect(removedNote(statusAudit.targets[0])).toBe(null);
    expect(removedNote(gone({ proposals: [retirement("approved")] }))).toBe("removed by this audit");
    expect(removedNote(gone())).toMatch(/^removed /);
    expect(removedNote(gone())).not.toBe("removed by this audit");
  });
  it("12b · a retirement nobody approved has not removed anything", () => {
    // The Location is still there; the Proposal is only a request.
    expect(removedNote({ ...statusAudit.targets[0], proposals: [retirement(null)] })).toBe(null);
    expect(removedNote({ ...statusAudit.targets[0], proposals: [retirement("rejected")] })).toBe(null);
    // Retired, but this audit's request was refused - somebody else took it.
    expect(removedNote(gone({ proposals: [retirement("rejected")] }))).toMatch(/^removed /);
  });
  it("13 · the note leads the Notes cell, and the row is flagged for striking", () => {
    const report: AuditReport = {
      ...statusAudit,
      targets: [gone({ proposals: [retirement("approved")] }), statusAudit.targets[3]],
    };
    const rows = wideRows(report);
    expect(rows[0].removed).toBe(true);
    expect(rows[0].notes.startsWith("removed by this audit")).toBe(true);
    // the row that was never reached keeps what it always said
    expect(rows[1].removed).toBe(false);
    expect(rows[1].notes).toMatch(/not audited/);
  });
  it("14 · the summary mentions it, and stays quiet when nothing went", () => {
    const report: AuditReport = { ...statusAudit, targets: [gone(), statusAudit.targets[1]] };
    expect(narrative(report, summarize(report)).join(" ")).toMatch(/1 location has since been removed/);
    expect(narrative(statusAudit, summarize(statusAudit)).join(" ")).not.toMatch(/removed/);
  });
});
