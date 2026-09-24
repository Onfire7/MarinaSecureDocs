import { describe, expect, it } from "vitest";
import { classifyProposal, groupProposals, type ClassifiableProposal } from "./auditProposals";

// Tests 10 and 11 of the list approved 2026-09-24. Sorting Proposals by
// what a decision would mean (docs/audits.md § Filling a blank is not a
// decision) - the point being that the handful of real questions must not
// be lost among four hundred that decide nothing.

const p = (over: Partial<ClassifiableProposal> & { kind: string }): ClassifiableProposal => ({
  structural: 0,
  fills_blank: 0,
  payload: "{}",
  ...over,
});

describe("classifyProposal", () => {
  it("10 · a first value fills a blank; the same value over one on file is a change", () => {
    expect(classifyProposal(p({ kind: "set_attribute", fills_blank: 1, payload: '{"value":38}' }))).toBe("blank");
    expect(classifyProposal(p({ kind: "set_attribute", fills_blank: 0, payload: '{"value":38}' }))).toBe("change");
    expect(classifyProposal(p({ kind: "set_service", fills_blank: 1, payload: '{"present":true}' }))).toBe("blank");
    expect(classifyProposal(p({ kind: "set_amenity", fills_blank: 1, payload: '{"present":true}' }))).toBe("blank");
  });
  it("10b · taking something away is never filling a blank", () => {
    expect(classifyProposal(p({ kind: "set_service", fills_blank: 1, payload: '{"present":false}' }))).toBe("removal");
    expect(classifyProposal(p({ kind: "set_amenity", payload: '{"present":false}' }))).toBe("removal");
    expect(classifyProposal(p({ kind: "set_attribute", fills_blank: 1, payload: '{"value":null,"text":null}' }))).toBe("removal");
  });
  it("10c · structural wins over everything, and GPS is always a question", () => {
    expect(classifyProposal(p({ kind: "create_location", structural: 1 }))).toBe("structural");
    expect(classifyProposal(p({ kind: "retire_location", structural: 1 }))).toBe("structural");
    // A pin on a Location that has none is still not applied unreviewed.
    expect(classifyProposal(p({ kind: "set_gps", fills_blank: 1, payload: '{"lat":1,"lng":2}' }))).toBe("change");
  });
  it("10d · a payload that will not parse is classified, not thrown", () => {
    expect(classifyProposal(p({ kind: "set_service", payload: "not json" }))).toBe("change");
  });
});

describe("groupProposals", () => {
  it("11 · the ones that decide nothing come first, and empty groups do not appear", () => {
    const rows = [
      p({ kind: "create_location", structural: 1 }),
      p({ kind: "set_attribute", fills_blank: 0, payload: '{"value":40}' }),
      p({ kind: "set_attribute", fills_blank: 1, payload: '{"value":38}' }),
      p({ kind: "set_service", payload: '{"present":false}' }),
    ];
    expect(groupProposals(rows).map((g) => `${g.cls}:${g.rows.length}`)).toEqual([
      "blank:1",
      "change:1",
      "removal:1",
      "structural:1",
    ]);
    expect(groupProposals([p({ kind: "set_attribute", fills_blank: 1, payload: '{"value":1}' })]).map((g) => g.cls)).toEqual(["blank"]);
    expect(groupProposals([])).toEqual([]);
  });
});
