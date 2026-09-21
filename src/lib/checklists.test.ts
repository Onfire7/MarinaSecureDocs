import { describe, expect, it, vi } from "vitest";
import {
  eligibleToday,
  isVisibleNow,
  recurrenceMatchesDay,
  resolveDueBy,
  expectedStartAnchor,
  hideUntilFromAnchor,
  hideUntilWarning,
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
      trigger_type: "recurring",
      triggerConfig: { recurrenceRule: "FREQ=WEEKLY;BYDAY=TU" },
    };
    expect(eligibleToday(recurring, TUESDAY)).toBe(true);
    expect(eligibleToday(recurring, WEDNESDAY)).toBe(false);
    expect(eligibleToday({ trigger_type: "manual" }, WEDNESDAY)).toBe(true);
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
    expect(isVisibleNow({ hide_until: null })).toBe(true);
    expect(isVisibleNow({})).toBe(true);
  });

  it("accepts hideUntil as a number or an ISO string", () => {
    const at = Date.UTC(2026, 7, 25, 19, 0, 0);
    expect(isVisibleNow({ hide_until: at }, at + 1)).toBe(true);
    expect(isVisibleNow({ hide_until: new Date(at).toISOString() }, at + 1)).toBe(true);
    expect(isVisibleNow({ hide_until: at }, at - 1)).toBe(false);
  });

  it("is visible exactly at hideUntil", () => {
    // Boundary is inclusive: a row must not stay hidden for the one tick it
    // becomes due.
    const at = Date.UTC(2026, 7, 25, 19, 0, 0);
    expect(isVisibleNow({ hide_until: at }, at)).toBe(true);
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
    expect(sectionCompletionTime([{ completed_at: 1000 }, { completed_at: null }])).toBeNull();
    expect(sectionCompletionTime([{ completed_at: 1000 }, {}])).toBeNull();
  });

  it("is the latest completion once all items are done", () => {
    const later = Date.UTC(2026, 7, 25, 20, 0, 0);
    expect(
      sectionCompletionTime([
        { completed_at: Date.UTC(2026, 7, 25, 19, 0, 0) },
        { completed_at: new Date(later).toISOString() },
      ]),
    ).toBe(later);
  });
});

// ── Expected start ─────────────────────────────────────────────────────────
//
// A hide-until is a clock time, and a clock time needs a date. The date used
// to come from the moment the checklist was created, rolling FORWARD to the
// next occurrence — which is only right if the checklist is created before
// every reveal inside it. A guard who clocked in at 10:33 PM had the 7, 8 and
// 9 PM sections hidden until the following evening. One who starts after
// midnight has it differently and no better: 8 PM resolves to later that same
// calendar date, nineteen hours away, when the right answer is 8 PM on the
// PREVIOUS date — a moment the old code could not produce, because it never
// looked back.
//
// All dates here are built in local time, as the code computes them, so these
// hold in any timezone.
const at = (d: number, h: number, m = 0, month = 8) => new Date(2026, month, d, h, m, 0, 0);

describe("expectedStartAnchor", () => {
  it("anchors on the nearest occurrence of the expected start", () => {
    expect(expectedStartAnchor("17:00", at(19, 22, 33))).toEqual(at(19, 17)); // late
    expect(expectedStartAnchor("17:00", at(19, 16, 50))).toEqual(at(19, 17)); // early
    expect(expectedStartAnchor("17:00", at(19, 17, 0))).toEqual(at(19, 17)); // on time
  });

  it("created after midnight, the anchor is the previous evening", () => {
    expect(expectedStartAnchor("17:00", at(20, 0, 30))).toEqual(at(19, 17));
    expect(expectedStartAnchor("17:00", at(20, 4, 59))).toEqual(at(19, 17));
  });

  it("an exact 12-hour tie resolves to the past", () => {
    expect(expectedStartAnchor("17:00", at(20, 5, 0))).toEqual(at(19, 17));
    expect(expectedStartAnchor("17:00", at(20, 5, 1))).toEqual(at(20, 17));
  });

  it("with no expected start, the anchor is the creation time", () => {
    expect(expectedStartAnchor(null, at(19, 22, 33))).toEqual(at(19, 22, 33));
    expect(expectedStartAnchor("  ", at(19, 22, 33))).toEqual(at(19, 22, 33));
  });

  it("a malformed expected start is ignored, not fatal", () => {
    expect(expectedStartAnchor("five-ish", at(19, 22, 33))).toEqual(at(19, 22, 33));
    expect(expectedStartAnchor("25:00", at(19, 22, 33))).toEqual(at(19, 22, 33));
  });

  it("holds across a month boundary", () => {
    expect(expectedStartAnchor("17:00", at(1, 0, 30, 9))).toEqual(at(30, 17, 0, 8));
  });
});

describe("resolveHideUntil with an expected start", () => {
  const reveal = (rule: string, created: Date, expected: string | null = "17:00") =>
    new Date(resolveHideUntil(rule, created, expected)!);

  it("a reveal that already passed since the expected start shows at once", () => {
    // 19 September, as it happened.
    const created = at(19, 22, 33);
    for (const rule of ["19:00", "20:00", "21:00"]) {
      expect(reveal(rule, created).getTime()).toBeLessThan(created.getTime());
    }
    expect(reveal("20:00", created)).toEqual(at(19, 20));
  });

  it("a reveal still ahead hides until then", () => {
    expect(reveal("20:00", at(19, 17, 10))).toEqual(at(19, 20));
    expect(reveal("20:00", at(19, 16, 50))).toEqual(at(19, 20)); // started early
  });

  it("created after midnight, an evening reveal is already past", () => {
    const created = at(20, 0, 30);
    expect(reveal("20:00", created)).toEqual(at(19, 20)); // YESTERDAY's date
    expect(reveal("20:00", created).getTime()).toBeLessThan(created.getTime());
  });

  it("created after midnight, a small-hours reveal is still ahead", () => {
    expect(reveal("02:00", at(20, 0, 30))).toEqual(at(20, 2));
  });

  it("created after midnight, a reveal earlier in the small hours has passed", () => {
    const created = at(20, 3, 0);
    expect(reveal("02:00", created)).toEqual(at(20, 2));
    expect(reveal("02:00", created).getTime()).toBeLessThan(created.getTime());
  });

  it("a reveal earlier in the day than the expected start means the next day", () => {
    expect(reveal("02:00", at(19, 17, 10))).toEqual(at(20, 2));
  });

  it("a reveal at the expected start itself is not pushed a day out", () => {
    expect(reveal("17:00", at(19, 17, 5))).toEqual(at(19, 17));
  });

  it("a reveal never lands more than 24 hours from the anchor", () => {
    // Every hour of creation, every hour of rule: nothing is ever hidden for
    // more than a day past the expected start, and nothing resolves before it.
    for (let h = 0; h < 24; h++) {
      const created = at(19, h, 15);
      const anchor = expectedStartAnchor("17:00", created).getTime();
      for (let r = 0; r < 24; r++) {
        const t = reveal(`${String(r).padStart(2, "0")}:00`, created).getTime();
        expect(t).toBeGreaterThanOrEqual(anchor);
        expect(t - anchor).toBeLessThan(24 * 3_600_000);
      }
    }
  });

  it("holds across a DST change", () => {
    // US clocks fall back on 1 Nov 2026. Where the zone has no such change the
    // same assertions hold trivially.
    const created = new Date(2026, 10, 1, 0, 30);
    expect(reveal("20:00", created)).toEqual(new Date(2026, 9, 31, 20, 0));
    expect(reveal("03:00", created)).toEqual(new Date(2026, 10, 1, 3, 0));
  });

  it("with no expected start, behaves exactly as before", () => {
    expect(reveal("20:00", at(19, 22, 33), null)).toEqual(at(20, 20));
    expect(new Date(resolveHideUntil("20:00", at(19, 22, 33))!)).toEqual(at(20, 20));
  });

  it("the late-start warning clears once an expected start is set", () => {
    expect(hideUntilWarning("template", "manual")).toBeTruthy();
    expect(hideUntilWarning("template", "manual", "17:00")).toBeUndefined();
    expect(hideUntilWarning("section", "checkpoint", "17:00")).toBeUndefined();
    // Clock-in was assumed always punctual, and had no warning. It wasn't.
    expect(hideUntilWarning("template", "clock_in")).toBeTruthy();
    expect(hideUntilWarning("template", "clock_in", "17:00")).toBeUndefined();
  });
});

describe("hideUntilFromAnchor", () => {
  it("a section added long after the checklist began keeps the checklist's anchor", () => {
    // A checkpoint scanned at 6 AM adds its section to a checklist due at 5 PM
    // the evening before. Six in the morning is NEARER to tonight's 5 PM than
    // to last night's, so re-deriving the anchor at scan time would hide an
    // 8 PM section for another fourteen hours. The anchor is resolved once,
    // when the checklist is created, and stored on it.
    const anchor = at(19, 17);
    const scannedAt = at(20, 6);
    expect(expectedStartAnchor("17:00", scannedAt)).toEqual(at(20, 17)); // the trap
    expect(new Date(hideUntilFromAnchor("20:00", anchor)!)).toEqual(at(19, 20));
    expect(hideUntilFromAnchor("20:00", anchor)!).toBeLessThan(scannedAt.getTime());
  });

  it("treats blank and malformed rules as visible", () => {
    expect(hideUntilFromAnchor(null, at(19, 17))).toBeNull();
    expect(hideUntilFromAnchor("soon", at(19, 17))).toBeNull();
  });
});
