import { describe, expect, it } from "vitest";
import {
  KEYS_MODE,
  isLanguageCode,
  keysModeAfterQuery,
  matchLanguage,
  resolveUiLanguage,
} from "./resolveLanguage";

// docs/localization.md § Two languages — the UI language resolution order.
const available = ["en", "es"];
const base = {
  keysMode: false,
  user: undefined as string | null | undefined,
  device: null as string | null,
  navigator: [] as string[],
  available,
};

describe("resolveUiLanguage", () => {
  it("keys mode outranks everything", () => {
    expect(resolveUiLanguage({ ...base, keysMode: true, user: "es", device: "es", navigator: ["es"] })).toBe(KEYS_MODE);
  });

  it("the user's choice outranks the device and the browser", () => {
    expect(resolveUiLanguage({ ...base, user: "es", device: "en", navigator: ["en-US"] })).toBe("es");
  });

  it("before the user row loads, the device's last language outranks the browser", () => {
    expect(resolveUiLanguage({ ...base, user: undefined, device: "es", navigator: ["en-US"] })).toBe("es");
  });

  it("once the user row has loaded, the device cache no longer applies — a shared phone does not hand one user's language to the next", () => {
    expect(resolveUiLanguage({ ...base, user: null, device: "es", navigator: ["en-US"] })).toBe("en");
  });

  it("falls back to the browser's languages, in order, matching a regional code to its base", () => {
    expect(resolveUiLanguage({ ...base, user: null, navigator: ["fr-FR", "es-MX", "en"] })).toBe("es");
  });

  it("falls back to English when nothing has a catalog", () => {
    expect(resolveUiLanguage({ ...base, user: null, navigator: ["fr-FR"] })).toBe("en");
  });

  it("a stored language with no catalog (removed, or never shipped) is skipped, not obeyed", () => {
    expect(resolveUiLanguage({ ...base, user: "de", device: "de", navigator: ["es"] })).toBe("es");
  });
});

describe("matchLanguage", () => {
  it("prefers an exact match over the base language", () => {
    expect(matchLanguage("pt-BR", ["pt", "pt-BR"])).toBe("pt-BR");
    expect(matchLanguage("pt-PT", ["pt", "pt-BR"])).toBe("pt");
    expect(matchLanguage("fr", ["pt"])).toBeNull();
  });
});

describe("keysModeAfterQuery", () => {
  it("?lng=keys turns keys mode on, and it sticks without the parameter", () => {
    expect(keysModeAfterQuery("keys", false)).toBe(true);
    expect(keysModeAfterQuery(null, true)).toBe(true);
  });

  it("?lng= with any other value clears it", () => {
    expect(keysModeAfterQuery("", true)).toBe(false);
    expect(keysModeAfterQuery("en", true)).toBe(false);
  });

  it("absent, it stays off", () => {
    expect(keysModeAfterQuery(null, false)).toBe(false);
  });
});

describe("isLanguageCode", () => {
  it("accepts the shape the database accepts", () => {
    for (const ok of ["en", "es", "pt-BR", "zh-Hant", "fil"]) expect(isLanguageCode(ok)).toBe(true);
    for (const bad of ["", "E", "english", "en_US", "en-", "keys!", " es"]) expect(isLanguageCode(bad)).toBe(false);
  });
});
