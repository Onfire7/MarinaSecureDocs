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
