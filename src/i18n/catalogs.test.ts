import { describe, expect, it } from "vitest";
import { CATALOGS, LANGUAGES } from "./catalogs";
import { interpolationDifferences, keyDifferences, missingPluralForms } from "./catalogCheck";

// docs/localization.md § Catalogs. tsc already refuses a translation that
// does not satisfy English's shape; this is the same check at runtime (an
// `as any` cannot dodge it), plus the one tsc cannot make: plural forms.

describe("the checks themselves", () => {
  it("keyDifferences names missing and extra keys, nested ones included", () => {
    const en = { a: { b: "x", c: "y" }, d: "z" };
    const xx = { a: { b: "x", e: "y" }, d: "z" };
    expect(keyDifferences(en, xx)).toEqual({ missing: ["a.c"], extra: ["a.e"] });
  });

  it("missingPluralForms names each base key short of the language's categories", () => {
    const es = { n: { days_one: "", days_other: "" }, ok_one: "", ok_many: "", ok_other: "" };
    expect(missingPluralForms(es, "es")).toEqual(["n.days_many"]);
    expect(missingPluralForms({ days_one: "", days_other: "" }, "en")).toEqual([]);
  });
});

describe("interpolationDifferences", () => {
  it("names each key whose {{values}} differ from the source's", () => {
    const en = { added: "Note added on {{target}}", moved: "{{boat}} moved to {{slip}}", plain: "Saved" };
    const xx = { added: "Nota en {{objetivo}}", moved: "{{slip}}: {{boat}}", plain: "Guardado" };
    expect(interpolationDifferences(en, xx)).toEqual(["added"]);
  });

  it("ignores format arguments, comparing names only", () => {
    expect(interpolationDifferences({ at: "{{when, datetime(hour: numeric)}}" }, { at: "{{when, datetime}}" })).toEqual([]);
  });
});

describe("the real catalogs", () => {
  it("has a records namespace, for the sentences dataT stores", () => {
    expect(CATALOGS.en.records).toBeTypeOf("object");
  });

  it.each(LANGUAGES.filter((l) => l !== "en"))(
    "%s keeps every {{value}} of every stored sentence — a record never loses its subject",
    (lng) => {
      expect(interpolationDifferences(CATALOGS.en.records, CATALOGS[lng].records)).toEqual([]);
    },
  );

  it("English is a shipped language", () => {
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES[0]).toBe("en");
  });

  it.each(LANGUAGES.filter((l) => l !== "en"))("%s has exactly English's keys", (lng) => {
    expect(keyDifferences(CATALOGS.en, CATALOGS[lng])).toEqual({ missing: [], extra: [] });
  });

  it.each(LANGUAGES)("%s has every plural form its language uses", (lng) => {
    expect(missingPluralForms(CATALOGS[lng], lng)).toEqual([]);
  });

  it.each(LANGUAGES)("%s names itself, for the language picker", (lng) => {
    expect(CATALOGS[lng].common.languageName).toBeTruthy();
  });
});
