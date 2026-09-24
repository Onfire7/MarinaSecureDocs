import { describe, expect, it } from "vitest";
import { describeFilter, isEmptyFilter, tidyFilter, type ShareOptions } from "./auditShareFilter";

// What a Share Link leaves out, in words (docs/audits.md § A link can show
// less). The filter itself is enforced in the database and covered by
// supabase/tests/090_audit_report.sql; what is here is the vocabulary the
// share form builds one with and the links table reads one back in.

const options: ShareOptions = {
  kind: "status",
  includeAttributes: true,
  includeServices: true,
  includeAmenities: true,
  includeMarked: true,
  includeMap: true,
  services: [
    { id: "s1", name: "Shore power 30A" },
    { id: "s2", name: "Sewer" },
  ],
  amenities: [{ id: "m1", name: "Fire pit" }],
  attributes: [{ id: "a1", name: "Max boat length" }],
  questions: [{ id: "q1", prompt: "Is the pedestal breaker labelled?" }],
  targets: Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, name: `RV${i}`, area: "Campgrounds" })),
};

describe("tidyFilter", () => {
  it("1 · an untouched form is the whole report, stored as {}", () => {
    expect(tidyFilter({}, 50)).toEqual({});
    expect(tidyFilter({ categories: [], services: [], targets: [] }, 50)).toEqual({});
    expect(isEmptyFilter(tidyFilter({}, 50))).toBe(true);
  });
  it("2 · every location selected is the same as no restriction", () => {
    const all = options.targets.map((t) => t.id);
    expect(tidyFilter({ targets: all }, 50).targets).toBeUndefined();
    expect(tidyFilter({ targets: all.slice(0, 4) }, 50).targets).toHaveLength(4);
  });
});

describe("describeFilter", () => {
  it("3 · says what a link leaves out, so two links are told apart", () => {
    expect(describeFilter({}, options)).toBe("everything");
    expect(describeFilter(null, options)).toBe("everything");
    expect(describeFilter({ categories: ["gps"], services: ["s1"], targets: ["t0", "t1", "t2", "t3"] }, options)).toBe(
      "hides GPS, Shore power 30A · 4 of 50 locations",
    );
    expect(describeFilter({ questions: ["q1"] }, options)).toBe("hides Is the pedestal breaker labelled?");
  });
  it("4 · an id nothing answers to is dropped, not rendered as one", () => {
    // A catalogue entry deleted after the link was made. The database still
    // hides by id; this line just has nothing to name.
    expect(describeFilter({ services: ["gone"] }, options)).toBe("a filter is set");
    expect(describeFilter({ categories: ["gps"], services: ["gone"] }, options)).toBe("hides GPS");
    expect(describeFilter({ targets: ["t0"] }, null)).toBe("1 locations");
  });
});
