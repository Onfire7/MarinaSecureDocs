import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration, shiftWindowMs, withinWindow } from "./shiftReport";

const START = Date.UTC(2026, 7, 24, 18, 9, 0);

afterEach(() => vi.useRealTimers());

describe("shiftWindowMs", () => {
  it("ends an open shift at now, so mid-shift views show progress so far", () => {
    const now = START + 8 * 3_600_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(shiftWindowMs({ started_at: START })).toEqual({ start: START, end: now });
    expect(shiftWindowMs({ started_at: START, ended_at: null })).toEqual({ start: START, end: now });
  });

  it("ends a closed shift at endedAt", () => {
    const ended = START + 3_600_000;
    expect(shiftWindowMs({ started_at: START, ended_at: ended })).toEqual({
      start: START,
      end: ended,
    });
  });

  it("accepts ISO strings as well as epoch numbers", () => {
    expect(
      shiftWindowMs({
        started_at: new Date(START).toISOString(),
        ended_at: new Date(START + 60_000).toISOString(),
      }),
    ).toEqual({ start: START, end: START + 60_000 });
  });
});

describe("withinWindow", () => {
  const window = { start: 1000, end: 2000 };

  it("includes both boundaries", () => {
    // Records associate with a shift by timestamp, not by reference — an
    // exclusive boundary would drop the check-in made at the exact moment a
    // shift started.
    expect(withinWindow(1000, window)).toBe(true);
    expect(withinWindow(2000, window)).toBe(true);
  });

  it("excludes timestamps outside the window", () => {
    expect(withinWindow(999, window)).toBe(false);
    expect(withinWindow(2001, window)).toBe(false);
  });

  it("excludes a missing timestamp rather than counting it", () => {
    expect(withinWindow(null, window)).toBe(false);
    expect(withinWindow(undefined, window)).toBe(false);
  });
});

describe("formatDuration", () => {
  it("renders hours and minutes, or minutes alone", () => {
    expect(formatDuration({ start: 0, end: 8 * 3_600_000 + 14 * 60_000 })).toBe("8h 14m");
    expect(formatDuration({ start: 0, end: 45 * 60_000 })).toBe("45m");
    expect(formatDuration({ start: 0, end: 3_600_000 })).toBe("1h 0m");
  });

  it("clamps a negative window to zero", () => {
    expect(formatDuration({ start: 1000, end: 0 })).toBe("0m");
  });
});
