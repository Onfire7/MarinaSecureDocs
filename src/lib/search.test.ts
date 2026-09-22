import { describe, expect, it } from "vitest";
import { matchesTerms, queryTerms } from "./search";

describe("matchesTerms", () => {
  it("matches everything when no terms were typed", () => {
    expect(matchesTerms(["Dock A", "Slip 14"], [])).toBe(true);
  });

  it("anchors short terms to the start of a word", () => {
    // The bug this split exists for: "c" is a substring of "do(c)k", so
    // without the word-start rule, searching "dock c 14" also returns
    // Dock A's Slip 14 — and short terms are exactly the disambiguating
    // ones in marina naming.
    expect(matchesTerms(["Dock A → Slip 14"], queryTerms("dock c 14"))).toBe(false);
    expect(matchesTerms(["Dock C → Slip 14"], queryTerms("dock c 14"))).toBe(true);
  });

  it("lets longer terms match anywhere in the haystack", () => {
    expect(matchesTerms(["Boathouse 30"], queryTerms("house"))).toBe(true);
  });

  it("requires every term to match", () => {
    expect(matchesTerms(["Dock C → Slip 14"], queryTerms("dock 99"))).toBe(false);
  });

  it("splits on the separators used in location paths", () => {
    expect(matchesTerms(["Marina → Dock C/Slip 14"], queryTerms("c"))).toBe(true);
  });
});

describe("queryTerms", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(queryTerms("  Dock   C  ")).toEqual(["dock", "c"]);
  });

  it("is empty for a blank query", () => {
    expect(queryTerms("   ")).toEqual([]);
  });
});
