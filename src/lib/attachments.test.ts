import { describe, expect, it } from "vitest";
import { TARGET_TYPES, attachmentLink, attachmentOf, targetPath } from "./attachments";

/**
 * The attachable-entities pattern: every Note, Incident and Ticket attaches
 * to exactly one of six targets.
 *
 * That invariant is currently enforced only by application code, and one of
 * seven real tickets violates it. The migration turns it into a database
 * CHECK constraint — `num_nonnulls(...) = 1` — see docs/data-model.md. These
 * tests pin the reader's half of the behaviour either way.
 */
describe("attachmentOf", () => {
  it("returns the single set target", () => {
    expect(attachmentOf({ location: { id: "l1", name: "Slip 14" } })).toEqual({
      type: "location",
      id: "l1",
      label: "Slip 14",
    });
  });

  it("labels a vehicle by its description, since vehicles have no name", () => {
    expect(attachmentOf({ vehicle: { id: "v1", description: "Red pickup" } })).toEqual({
      type: "vehicle",
      id: "v1",
      label: "Red pickup",
    });
  });

  it("falls back to a placeholder label for a nameless contact", () => {
    expect(attachmentOf({ contact: { id: "c1", name: null } })?.label).toBe("Unnamed contact");
  });

  it("returns null when nothing is attached", () => {
    // The state the CHECK constraint will make unreachable — and the reason
    // one existing ticket is dropped at migration rather than carried.
    expect(attachmentOf({})).toBeNull();
  });
});

describe("targetPath", () => {
  it("routes every one of the six target types", () => {
    for (const { key } of TARGET_TYPES) {
      const path = targetPath({ type: key, id: "x1", label: "X" });
      expect(path.startsWith("/")).toBe(true);
      expect(path).toContain("x1");
    }
  });
});

describe("attachmentLink", () => {
  it("builds a single-key link payload", () => {
    expect(attachmentLink({ type: "asset", id: "a1", label: "Cart 3" })).toEqual({ asset: "a1" });
  });
});
