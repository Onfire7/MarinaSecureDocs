import { describe, expect, it } from "vitest";
import {
  displayName,
  findSimilarContacts,
  isNameless,
  normalizePhone,
  resolveContact,
} from "./contacts";
import { aContact } from "../test/fixtures";

const byId = <T extends { id: string }>(all: T[]) => new Map(all.map((c) => [c.id, c]));

describe("resolveContact", () => {
  it("follows a merge chain to the canonical record", () => {
    const canonical = aContact({ id: "c" });
    const middle = aContact({ id: "b", merged_into_id: "c" });
    const start = aContact({ id: "a", merged_into_id: "b" });
    expect(resolveContact(start, byId([start, middle, canonical])).id).toBe("c");
  });

  it("terminates on a merge cycle instead of looping forever", () => {
    // A cycle is only reachable through bad data, but this walks the chain on
    // every render of every call and SMS row — looping here freezes the UI
    // rather than showing a wrong name.
    const a = aContact({ id: "a", merged_into_id: "b" });
    const b = aContact({ id: "b", merged_into_id: "a" });
    expect(["a", "b"]).toContain(resolveContact(a, byId([a, b])).id);
  });

  it("stops at the last resolvable record when the target is missing", () => {
    const orphan = aContact({ id: "a", merged_into_id: "gone" });
    expect(resolveContact(orphan, byId([orphan])).id).toBe("a");
  });
});

describe("isNameless / displayName", () => {
  it("treats blank and whitespace-only names as nameless", () => {
    expect(isNameless(aContact({ name: "" }))).toBe(true);
    expect(isNameless(aContact({ name: "   " }))).toBe(true);
    expect(isNameless(aContact({ name: null }))).toBe(true);
    expect(displayName(aContact({ name: "  " }))).toBe("Unnamed contact");
  });

  it("trims a real name", () => {
    expect(displayName(aContact({ name: "  Dana Reyes  " }))).toBe("Dana Reyes");
  });
});

describe("normalizePhone", () => {
  it("makes differently formatted numbers compare equal", () => {
    expect(normalizePhone("(555) 123-4567")).toBe(normalizePhone("555-123-4567"));
    expect(normalizePhone("+1 555 123 4567")).toBe("15551234567");
  });

  it("returns an empty string for absent numbers", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("findSimilarContacts", () => {
  it("matches on phone regardless of name", () => {
    const self = aContact({ id: "self", name: "", phone: "(555) 123-4567" });
    const sameNumber = aContact({ id: "other", name: "Dana Reyes", phone: "555-123-4567" });
    const noise = aContact({ id: "noise", phone: "555-000-0000" });
    const found = findSimilarContacts("Dana", self, [sameNumber, noise]);
    expect(found.map((c) => c.id)).toEqual(["other"]);
  });

  it("matches names as substrings in either direction", () => {
    const self = aContact({ id: "self", name: "", phone: null });
    const longer = aContact({ id: "longer", name: "Dana Reyes", phone: null });
    const shorter = aContact({ id: "shorter", name: "Dana", phone: null });
    expect(findSimilarContacts("Dana", self, [longer, shorter]).map((c) => c.id)).toEqual([
      "longer",
      "shorter",
    ]);
  });

  it("excludes the contact being named and anything already merged away", () => {
    const self = aContact({ id: "self", name: "Dana", phone: "555-123-4567" });
    const merged = aContact({ id: "merged", name: "Dana", phone: "555-123-4567", merged_into_id: "x" });
    expect(findSimilarContacts("Dana", self, [self, merged])).toEqual([]);
  });

  it("ignores needles shorter than two characters", () => {
    // Otherwise typing the first letter of a name proposes merging with
    // every contact at the marina.
    const self = aContact({ id: "self", name: "", phone: null });
    const others = [aContact({ name: "Dana" }), aContact({ name: "Devon" })].map((c) => ({
      ...c,
      phone: null,
    }));
    expect(findSimilarContacts("D", self, others)).toEqual([]);
  });
});
