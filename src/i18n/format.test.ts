import { describe, expect, it } from "vitest";
import { makeFormatters } from "./format";
import { i18n } from "./index";
import { createLocalizer } from "./localizer";

// A fixed instant and a fixed zone, so the output depends on the language
// alone — not on the machine running the test.
const at = new Date(Date.UTC(2026, 9, 20, 17, 4));
const utc = { timeZone: "UTC" } as const;

describe("formatters follow the UI language, not the process default", () => {
  it("dates", () => {
    const opts = { ...utc, month: "short", day: "numeric" } as const;
    expect(makeFormatters(() => "en").date(at, opts)).toBe("Oct 20");
    expect(makeFormatters(() => "es").date(at, opts)).toBe("20 oct");
  });

  it("times", () => {
    const opts = { ...utc, hour: "numeric", minute: "2-digit" } as const;
    // ICU puts a narrow no-break space before PM in newer releases.
    expect(makeFormatters(() => "en").time(at, opts)).toMatch(/^5:04\sPM$/);
    expect(makeFormatters(() => "es").time(at, opts)).toBe("17:04");
  });

  it("numbers", () => {
    expect(makeFormatters(() => "en").number(12345.6)).toBe("12,345.6");
    expect(makeFormatters(() => "es").number(12345.6)).toBe("12.345,6");
  });

  it("reads the language on every call, so a switch takes effect without rebuilding", () => {
    let lng = "en";
    const f = makeFormatters(() => lng);
    expect(f.number(1000.5)).toBe("1,000.5");
    lng = "es";
    expect(f.number(1000.5)).toBe("1000,5");
  });
});

describe("duration", () => {
  const en = makeFormatters(() => "en", i18n.getFixedT("en", "common"));
  const min = 60_000;

  it("reads in hours and minutes, dropping hours under one", () => {
    expect(en.duration(0)).toBe("0m");
    expect(en.duration(59 * min)).toBe("59m");
    expect(en.duration(60 * min)).toBe("1h 0m");
    expect(en.duration((25 * 60 + 3) * min)).toBe("25h 3m");
  });

  it("never goes negative — a clock a little ahead reads as 0m", () => {
    expect(en.duration(-5 * min)).toBe("0m");
  });

  it("follows the UI language", () => {
    const common = (hm: string, m: string) => ({ common: { duration: { hm, m } } });
    const l = createLocalizer({ en: common("{{h}}h {{m}}m", "{{m}}m"), es: common("{{h}} h {{m}} min", "{{m}} min") }, "es");
    const es = makeFormatters(() => "es", l.i18n.getFixedT("es", "common") as never);
    expect(es.duration(61 * min)).toBe("1 h 1 min");
  });
});
