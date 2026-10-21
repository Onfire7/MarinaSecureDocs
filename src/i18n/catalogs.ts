import type { Catalog } from "./locales/en";

// Every language with a catalog under locales/ — the folder name is the
// language code. A catalog other than English is typed `satisfies Catalog`,
// so it cannot exist here without being complete.
//
// Eager, and so in the main bundle: with one or two languages that costs
// less than a request. Lazy-load them once there are several.
const modules = import.meta.glob<{ default: Catalog }>("./locales/*/index.ts", { eager: true });

export const CATALOGS: Record<string, Catalog> = Object.fromEntries(
  Object.entries(modules).map(([path, m]) => [path.split("/")[2], m.default]),
);

/** Available languages, English first. */
export const LANGUAGES: readonly string[] = Object.keys(CATALOGS).sort((a, b) =>
  a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b),
);
