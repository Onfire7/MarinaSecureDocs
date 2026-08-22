/**
 * Short terms (1–2 chars) must match the start of a whole word; longer ones
 * may match anywhere. Without that split, searching "dock c 14" also matches
 * Dock *A*'s Slip 14, because "c" is a substring of "do**c**k" — and short
 * terms are exactly the disambiguating ones in marina naming ("Dock C").
 *
 * Shared by every admin search box so they all narrow the same way.
 */
export function matchesTerms(haystack: string[], terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = haystack.join(" ").toLowerCase();
  const words = hay.split(/[\s→/-]+/).filter(Boolean);
  return terms.every((t) =>
    t.length <= 2 ? words.some((w) => w.startsWith(t)) : hay.includes(t),
  );
}

/** Splits a raw query box value into the terms `matchesTerms` expects. */
export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}
