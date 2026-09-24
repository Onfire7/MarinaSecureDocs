// What a Share Link leaves out (docs/audits.md § A link can show less).
//
// The filter itself is enforced in the database - `filter_audit_report()`
// strips the document before it is sent, so a recipient cannot read past
// it. Nothing here is a gate; this is the vocabulary the share form and the
// links table use to build one and say what it does.
//
// Entries are ids, never names: the document identifies a Service by name,
// and a filter stored as text would stop matching the day somebody renames
// it - which, for a privacy filter, means showing what was meant to be
// hidden.

export interface ShareFilter {
  categories?: string[];
  services?: string[];
  amenities?: string[];
  attributes?: string[];
  questions?: string[];
  /** Empty or absent means every location. */
  targets?: string[];
}

/** The categories a report can be asked to leave out, in report order. */
export const SHARE_CATEGORIES = [
  "occupancy",
  "attributes",
  "services",
  "amenities",
  "questions",
  "marked",
  "map",
  "gps",
  "changes",
  "tickets",
] as const;
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ShareCategory, string> = {
  occupancy: "Occupancy",
  attributes: "Attributes",
  services: "Services",
  amenities: "Amenities",
  questions: "Questions",
  marked: "Marked",
  map: "Map",
  gps: "GPS",
  changes: "Changes",
  tickets: "Tickets",
};

/** What the share form offers: what this audit actually asked about. */
export interface ShareOptions {
  kind: "occupancy" | "status";
  includeAttributes: boolean;
  includeServices: boolean;
  includeAmenities: boolean;
  includeMarked: boolean;
  includeMap: boolean;
  services: { id: string; name: string }[];
  amenities: { id: string; name: string }[];
  attributes: { id: string; name: string }[];
  questions: { id: string; prompt: string }[];
  targets: { id: string; name: string; area: string | null }[];
}

export function isEmptyFilter(f: ShareFilter | null | undefined): boolean {
  if (!f) return true;
  return (
    !f.categories?.length &&
    !f.services?.length &&
    !f.amenities?.length &&
    !f.attributes?.length &&
    !f.questions?.length &&
    !f.targets?.length
  );
}

/** Drop the empty arrays, so an untouched form stores `{}` and the database
 *  can take the "no filter at all" short cut. */
export function tidyFilter(f: ShareFilter, targetCount: number): ShareFilter {
  const out: ShareFilter = {};
  if (f.categories?.length) out.categories = [...f.categories];
  if (f.services?.length) out.services = [...f.services];
  if (f.amenities?.length) out.amenities = [...f.amenities];
  if (f.attributes?.length) out.attributes = [...f.attributes];
  if (f.questions?.length) out.questions = [...f.questions];
  // Every location is the same as no restriction, and says so more plainly
  // to anyone reading the row later.
  if (f.targets?.length && f.targets.length < targetCount) out.targets = [...f.targets];
  return out;
}

/**
 * What a link leaves out, for the row in the links table. A list of links
 * that all look alike is a way to send the wrong one.
 */
export function describeFilter(f: ShareFilter | null | undefined, o: ShareOptions | null): string {
  if (isEmptyFilter(f)) return "everything";
  const parts: string[] = [];
  const named = (ids: string[] | undefined, from: { id: string; name?: string; prompt?: string }[] | undefined) =>
    (ids ?? [])
      .map((id) => from?.find((x) => x.id === id))
      .map((x) => x?.name ?? x?.prompt ?? null)
      .filter((x): x is string => x !== null);

  const cats = (f?.categories ?? []).map((c) => CATEGORY_LABEL[c as ShareCategory] ?? c);
  const entries = [
    ...named(f?.services, o?.services),
    ...named(f?.amenities, o?.amenities),
    ...named(f?.attributes, o?.attributes),
    ...named(f?.questions, o?.questions),
  ];
  const hidden = [...cats, ...entries];
  if (hidden.length) parts.push(`hides ${hidden.join(", ")}`);
  if (f?.targets?.length) parts.push(`${f.targets.length}${o ? ` of ${o.targets.length}` : ""} locations`);
  // Ids that answer to nothing: a catalogue entry deleted, or one no longer
  // valid for these location types. The database still hides by id, so this
  // must not read as "everything" - it would understate what the link does.
  return parts.length ? parts.join(" · ") : "a filter is set";
}
