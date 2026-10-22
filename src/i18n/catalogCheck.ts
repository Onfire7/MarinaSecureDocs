// Runtime checks over catalogs (docs/localization.md § Catalogs), used by
// catalogs.test.ts. tsc catches a missing key; only this catches a missing
// plural form, because which forms a language needs is Intl data, not types.

type Tree = { readonly [key: string]: string | Tree };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [prefix + k] : leaves(v, `${prefix}${k}.`),
  );
}

export function keyDifferences(source: Tree, other: Tree): { missing: string[]; extra: string[] } {
  const want = new Set(leaves(source));
  const have = new Set(leaves(other));
  return {
    missing: [...want].filter((k) => !have.has(k)),
    extra: [...have].filter((k) => !want.has(k)),
  };
}

/** `base_category` for every plural key short of a form `language` uses. */
export function missingPluralForms(catalog: Tree, language: string): string[] {
  const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  const keys = new Set(leaves(catalog));
  const bases = new Set([...keys].filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, "")));
  return [...bases].flatMap((b) => categories.map((c) => `${b}_${c}`).filter((k) => !keys.has(k)));
}

const VALUE = /{{\s*([^,}\s]+)[^}]*}}/g;

function valueNames(text: string): string {
  return [...text.matchAll(VALUE)].map((m) => m[1]).sort().join(",");
}

/**
 * Keys whose `{{value}}` names differ between `source` and `other`. Order
 * may change between languages and format arguments may differ; the set of
 * names may not, or a stored sentence silently drops what it is about.
 */
export function interpolationDifferences(source: Tree, other: Tree, prefix = ""): string[] {
  return Object.entries(source).flatMap(([k, v]) => {
    const o = other[k];
    if (typeof v === "string") return typeof o === "string" && valueNames(v) !== valueNames(o) ? [prefix + k] : [];
    return o && typeof o === "object" ? interpolationDifferences(v, o, `${prefix}${k}.`) : [];
  });
}
