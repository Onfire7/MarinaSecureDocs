import { describe, expect, it, vi } from "vitest";
import {
  eligibleToday,
  isVisibleNow,
  recurrenceMatchesDay,
  resolveDueBy,
  resolveHideUntil,
  sectionCompletionTime,
  sectionEnabledByStatus,
} from "./checklists";

// 2026-08-25 is a Tuesday; 2026-08-26 a Wednesday. Fixed rather than derived,
// so a failure names a date instead of an expression.
const TUESDAY = new Date(2026, 7, 25, 9, 0, 0);
const WEDNESDAY = new Date(2026, 7, 26, 9, 0, 0);

describe("recurrenceMatchesDay", () => {
  it("applies every day when no rule is set", () => {
    expect(recurrenceMatchesDay(null, TUESDAY)).toBe(true);
    expect(recurrenceMatchesDay("   ", TUESDAY)).toBe(true);
  });

  it("matches the day its rule names, and not others", () => {
    expect(recurrenceMatchesDay("FREQ=WEEKLY;BYDAY=TU", TUESDAY)).toBe(true);
    expect(recurrenceMatchesDay("FREQ=WEEKLY;BYDAY=TU", WEDNESDAY)).toBe(false);
  });

  it("fails OPEN on a malformed rule", () => {
    // Deliberate, and the opposite of what a permission check would do: an
    // admin typo should produce an extra checklist somebody dismisses, not
    // silently drop a night's scheduled work. Do not "fix" this to false.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(recurrenceMatchesDay("FREQ=NONSENSE;;;", TUESDAY)).toBe(true);
    err.mockRestore();
  });

  it("resolves a yearly rule despite dtstart defaulting to a year back", () => {
    // The implementation back-dates dtstart by 366 days so a rule can
    // generate an occurrence on the day being tested. A shorter window would
    // silently break YEARLY.
    expect(recurrenceMatchesDay("FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=25", TUESDAY)).toBe(true);
  });
});

describe("eligibleToday", () => {
  it("gates a recurring row on its rule and lets non-recurring rows through", () => {
    const recurring = {
      triggerType: "recurring",
      triggerConfig: { recurrenceRule: "FREQ=WEEKLY;BYDAY=TU" },
    };
    expect(eligibleToday(recurring, TUESDAY)).toBe(true);
    expect(eligibleToday(recurring, WEDNESDAY)).toBe(false);
    expect(eligibleToday({ triggerType: "manual" }, WEDNESDAY)).toBe(true);
  });
});

describe("resolveDueBy", () => {
  it("adds an offset in minutes to the creation time", () => {
    expect(resolveDueBy({ kind: "offset", minutes: 90 }, TUESDAY)).toBe(
      TUESDAY.getTime() + 90 * 60_000,
    );
  });

  it("rejects offsets that aren't a positive number of minutes", () => {
    expect(resolveDueBy({ kind: "offset", minutes: 0 }, TUESDAY)).toBeNull();
    expect(resolveDueBy({ kind: "offset", minutes: -30 }, TUESDAY)).toBeNull();
    expect(resolveDueBy({ kind: "offset", minutes: Number.NaN }, TUESDAY)).toBeNull();
  });

  it("resolves a clock time to its next occurrence", () => {
    const sameDay = resolveDueBy({ kind: "time", time: "17:00" }, TUESDAY);
    expect(new Date(sameDay!)).toEqual(new Date(2026, 7, 25, 17, 0, 0, 0));

    const alreadyPast = resolveDueBy({ kind: "time", time: "07:00" }, TUESDAY);
    expect(new Date(alreadyPast!)).toEqual(new Date(2026, 7, 26, 7, 0, 0, 0));
  });

  it("returns null with no rule at all", () => {
    expect(resolveDueBy(null, TUESDAY)).toBeNull();
  });
});

describe("resolveHideUntil", () => {
  it("treats a blank rule as visible immediately", () => {
    expect(resolveHideUntil(null, TUESDAY)).toBeNull();
    expect(resolveHideUntil("  ", TUESDAY)).toBeNull();
  });

  it("resolves a malformed clock time to visible rather than hidden", () => {
    // An admin typo must never hide assigned work.
    expect(resolveHideUntil("half past six", TUESDAY)).toBeNull();
  });

  it("resolves a valid rule to the next occurrence of that time", () => {
    expect(new Date(resolveHideUntil("19:00", TUESDAY)!)).toEqual(
      new Date(2026, 7, 25, 19, 0, 0, 0),
    );
  });
});

describe("isVisibleNow", () => {
  it("is visible with no hideUntil", () => {
    expect(isVisibleNow({ hideUntil: null })).toBe(true);
    expect(isVisibleNow({})).toBe(true);
  });

  it("accepts hideUntil as a number or an ISO string", () => {
    const at = Date.UTC(2026, 7, 25, 19, 0, 0);
    expect(isVisibleNow({ hideUntil: at }, at + 1)).toBe(true);
    expect(isVisibleNow({ hideUntil: new Date(at).toISOString() }, at + 1)).toBe(true);
    expect(isVisibleNow({ hideUntil: at }, at - 1)).toBe(false);
  });

  it("is visible exactly at hideUntil", () => {
    // Boundary is inclusive: a row must not stay hidden for the one tick it
    // becomes due.
    const at = Date.UTC(2026, 7, 25, 19, 0, 0);
    expect(isVisibleNow({ hideUntil: at }, at)).toBe(true);
  });
});

describe("sectionEnabledByStatus", () => {
  it("leaves an unconfigured gate CLOSED", () => {
    // The inverse of the recurrence rule above, and deliberately so: an
    // unconfigured status gate shouldn't quietly become an open one.
    expect(sectionEnabledByStatus([], "occupied")).toBe(false);
    expect(sectionEnabledByStatus(undefined, "occupied")).toBe(false);
    expect(sectionEnabledByStatus(null, "occupied")).toBe(false);
  });

  it("is closed when the location has no status at all", () => {
    expect(sectionEnabledByStatus(["occupied"], null)).toBe(false);
    expect(sectionEnabledByStatus(["occupied"], undefined)).toBe(false);
  });

  it("opens only on a listed status", () => {
    expect(sectionEnabledByStatus(["occupied", "needs_cleaning"], "needs_cleaning")).toBe(true);
    expect(sectionEnabledByStatus(["occupied"], "vacant")).toBe(false);
  });
});

describe("sectionCompletionTime", () => {
  it("is null for an empty section", () => {
    expect(sectionCompletionTime([])).toBeNull();
  });

  it("is null until every item is complete", () => {
    expect(sectionCompletionTime([{ completedAt: 1000 }, { completedAt: null }])).toBeNull();
    expect(sectionCompletionTime([{ completedAt: 1000 }, {}])).toBeNull();
  });

  it("is the latest completion once all items are done", () => {
    const later = Date.UTC(2026, 7, 25, 20, 0, 0);
    expect(
      sectionCompletionTime([
        { completedAt: Date.UTC(2026, 7, 25, 19, 0, 0) },
        { completedAt: new Date(later).toISOString() },
      ]),
    ).toBe(later);
  });
});
