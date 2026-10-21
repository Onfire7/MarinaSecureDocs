import { describe, expect, it } from "vitest";
import { createLocalizer as typedLocalizer } from "./localizer";
import { KEYS_MODE } from "./resolveLanguage";

// Fixture catalogs, so these tests prove the mechanism before any real
// second language exists.
const resources = {
  en: {
    common: {
      greeting: "Hello",
      welcome: "Welcome, {{name}}",
      days_one: "{{count}} day",
      days_other: "{{count}} days",
    },
  },
  es: {
    common: {
      greeting: "Hola",
      welcome: "Bienvenido, {{name}}",
      days_one: "{{count}} día",
      days_many: "{{count}} de días",
      days_other: "{{count}} días",
    },
  },
};

// The fixture keys are not the app's, so the typed `t` would refuse them.
type LooseT = (key: string, options?: Record<string, unknown>) => string;
function createLocalizer(resources: Record<string, Record<string, object>>, ui: string) {
  const l = typedLocalizer(resources, ui);
  return {
    ...l,
    i18n: { t: l.i18n.t as unknown as LooseT },
    dataT: l.dataT as unknown as LooseT,
  };
}

describe("dataT — the marina's language", () => {
  it("writes in the marina's language while the UI speaks another", () => {
    const l = createLocalizer(resources, "es");
    l.setDataLanguage("en");
    expect(l.i18n.t("greeting")).toBe("Hola");
    expect(l.dataT("greeting")).toBe("Hello");
    expect(l.dataT("days", { count: 3 })).toBe("3 days");
  });

  it("changing the marina's language moves dataT and leaves the UI alone", () => {
    const l = createLocalizer(resources, "en");
    l.setDataLanguage("es");
    expect(l.dataT("greeting")).toBe("Hola");
    expect(l.i18n.t("greeting")).toBe("Hello");
  });

  it("a marina language with no catalog writes English rather than keys", () => {
    const l = createLocalizer(resources, "en");
    l.setDataLanguage("de");
    expect(l.dataT("greeting")).toBe("Hello");
  });

  it("keys mode never reaches the database", () => {
    const l = createLocalizer(resources, KEYS_MODE);
    l.setDataLanguage("en");
    expect(l.i18n.t("greeting")).toBe("common:greeting");
    expect(l.dataT("greeting")).toBe("Hello");
  });
});

describe("keys mode", () => {
  it("renders namespace:key for plain, plural and interpolated lookups, with no values filled in", () => {
    const l = createLocalizer(resources, KEYS_MODE);
    expect(l.i18n.t("greeting")).toBe("common:greeting");
    expect(l.i18n.t("days", { count: 3 })).toBe("common:days");
    expect(l.i18n.t("welcome", { name: "Ana" })).toBe("common:welcome");
  });

  it("switches on and off at runtime", () => {
    const l = createLocalizer(resources, "en");
    l.setUiLanguage(KEYS_MODE);
    expect(l.i18n.t("greeting")).toBe("common:greeting");
    l.setUiLanguage("es");
    expect(l.i18n.t("greeting")).toBe("Hola");
  });

  it("formats in English while showing keys — Intl has no 'cimode' locale", () => {
    const l = createLocalizer(resources, KEYS_MODE);
    expect(l.uiLocale()).toBe("en");
  });
});

describe("plurals", () => {
  it("uses each language's own plural forms", () => {
    const l = createLocalizer(resources, "es");
    expect(l.i18n.t("days", { count: 1 })).toBe("1 día");
    expect(l.i18n.t("days", { count: 2 })).toBe("2 días");
    expect(l.i18n.t("days", { count: 1_000_000 })).toBe("1000000 de días");
  });
});
