// Dates and numbers in the UI language (docs/localization.md § Catalogs).
//
// The language is read on every call rather than captured, so switching it
// takes effect on the next render with nothing to rebuild.

import type { TFunction } from "i18next";

type When = Date | string | number;

/**
 * `t` is only needed by `duration`, whose units are words ("h", "m") rather
 * than anything Intl formats; callers that never ask for one may omit it.
 */
export function makeFormatters(language: () => string, t?: TFunction<"common">) {
  return {
    date: (v: When, o?: Intl.DateTimeFormatOptions) => new Date(v).toLocaleDateString(language(), o),
    time: (v: When, o?: Intl.DateTimeFormatOptions) => new Date(v).toLocaleTimeString(language(), o),
    dateTime: (v: When, o?: Intl.DateTimeFormatOptions) => new Date(v).toLocaleString(language(), o),
    number: (n: number, o?: Intl.NumberFormatOptions) => n.toLocaleString(language(), o),
    /** Elapsed milliseconds as hours and minutes ("4h 24m", "59m"). */
    duration: (ms: number) => {
      const total = Math.max(0, Math.floor(ms / 60_000));
      const h = Math.floor(total / 60);
      const m = total % 60;
      if (!t) throw new Error("makeFormatters: duration needs a t");
      return h > 0 ? t("duration.hm", { h, m }) : t("duration.m", { m });
    },
  };
}
