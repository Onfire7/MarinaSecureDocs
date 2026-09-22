import { describe, expect, it } from "vitest";
import { deterministicId } from "./detId";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministicId", () => {
  it("returns the same id for the same seed", () => {
    // This is the whole point: racing clients generating the same recurring
    // checklist must converge on one row, because .update() is an upsert.
    const seed = "checklist:2026-08-25:template-abc";
    expect(deterministicId(seed)).toBe(deterministicId(seed));
  });

  it("returns different ids for different seeds", () => {
    expect(deterministicId("checklist:2026-08-25:t1")).not.toBe(
      deterministicId("checklist:2026-08-25:t2"),
    );
    expect(deterministicId("checklist:2026-08-25:t1")).not.toBe(
      deterministicId("checklist:2026-08-26:t1"),
    );
  });

  it("is shaped like a v4 UUID", () => {
    // The database validates the shape, so a malformed id fails the write
    // rather than the function.
    for (const seed of ["", "a", "checkin:cp-1:2026-08-25T19:00:00Z"]) {
      expect(deterministicId(seed)).toMatch(UUID_V4);
    }
  });
});
