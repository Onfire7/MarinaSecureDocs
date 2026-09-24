// The pure half of the audit wizard (docs/audits.md § The wizard): what an
// "item" is, which items apply to a target, and the flat list of steps a run
// walks. Nothing here touches the database; src/lib/auditWizard.test.ts is
// the spec.

export type ItemKind = "status" | "occupied" | "attribute" | "service" | "amenity" | "question" | "marked" | "map" | "gps" | "confirm";

/** The page that ends a location: everything recorded there, and the button
 *  that says it is done. Selectable like any other item - a run that only
 *  gathers information turns it off - and always the last page of a
 *  location, wherever its group sits in the order. */
export const CONFIRM_KEY = "confirm";

export interface WizardItem {
  /** Stable across renders and runs: `service:<uuid>`, `marked`, … */
  key: string;
  kind: ItemKind;
  label: string;
  /** The heading it sits under on the setup screen, and its order. */
  group: string;
  entryId: string | null;
  unit?: string | null;
  choices?: string[];
  questionKind?: string;
  ticketOnNo?: boolean;
  /** Location types this item applies to; null = every target. */
  typeIds?: Set<string>;
  /** Questions apply only to the targets their Rule selected. */
  targetIds?: Set<string>;
}

export interface ItemGroup {
  label: string;
  items: WizardItem[];
}

/** Attributes first, then Services, Amenities - the order the Finding form,
 *  the location panel and the Admin catalogue all use. */
export const GROUP_ORDER = ["Occupancy", "Status", "Attributes", "Services", "Amenities", "Questions", "Checks", "GPS"] as const;

export interface AuditShape {
  kind: "occupancy" | "status";
  include_attributes: number;
  include_services: number;
  include_amenities: number;
  include_marked: number;
  include_map: number;
}
export interface CatalogueEntry {
  id: string;
  name: string;
  unit?: string | null;
  kind?: string;
  choices?: string | null;
}
export interface QuestionEntry {
  id: string;
  prompt: string;
  kind: string;
  choices: string | null;
  ticket_on_no: number;
}
export interface ValidityRow {
  location_type_id: string;
  service_id?: string;
  amenity_id?: string;
  attribute_id?: string;
}

function typeSet(rows: ValidityRow[], key: "service_id" | "amenity_id" | "attribute_id", id: string): Set<string> {
  return new Set(rows.filter((r) => r[key] === id).map((r) => r.location_type_id));
}
function parseChoices(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** Every item this audit could ask about, grouped for the setup screen. */
export function buildCatalogue(input: {
  audit: AuditShape;
  services: CatalogueEntry[];
  amenities: CatalogueEntry[];
  attributes: CatalogueEntry[];
  serviceValidity: ValidityRow[];
  amenityValidity: ValidityRow[];
  attributeValidity: ValidityRow[];
  questions: QuestionEntry[];
  questionTargets: { target_id: string; question_id: string }[];
}): ItemGroup[] {
  const { audit } = input;
  const groups = new Map<string, WizardItem[]>();
  const add = (group: string, item: WizardItem) => {
    (groups.get(group) ?? groups.set(group, []).get(group)!).push(item);
  };
  const status = audit.kind === "status";

  const first = status ? "Status" : "Occupancy";
  if (status) {
    add("Status", { key: "status", kind: "status", label: "Location status", group: "Status", entryId: null });
  } else {
    add("Occupancy", { key: "occupied", kind: "occupied", label: "Occupied?", group: "Occupancy", entryId: null });
  }
  add(first, { key: CONFIRM_KEY, kind: "confirm", label: "Confirm this location is done", group: first, entryId: null });
  if (status && audit.include_attributes === 1)
    for (const a of input.attributes)
      add("Attributes", {
        key: `attribute:${a.id}`,
        kind: "attribute",
        label: a.name,
        group: "Attributes",
        entryId: a.id,
        unit: a.unit ?? null,
        choices: a.kind === "choice" ? parseChoices(a.choices) : undefined,
        typeIds: typeSet(input.attributeValidity, "attribute_id", a.id),
      });
  if (status && audit.include_services === 1)
    for (const s of input.services)
      add("Services", {
        key: `service:${s.id}`,
        kind: "service",
        label: s.name,
        group: "Services",
        entryId: s.id,
        unit: s.unit ?? null,
        typeIds: typeSet(input.serviceValidity, "service_id", s.id),
      });
  if (status && audit.include_amenities === 1)
    for (const a of input.amenities)
      add("Amenities", {
        key: `amenity:${a.id}`,
        kind: "amenity",
        label: a.name,
        group: "Amenities",
        entryId: a.id,
        typeIds: typeSet(input.amenityValidity, "amenity_id", a.id),
      });
  for (const q of input.questions)
    add("Questions", {
      key: `question:${q.id}`,
      kind: "question",
      label: q.prompt,
      group: "Questions",
      entryId: q.id,
      questionKind: q.kind,
      choices: parseChoices(q.choices),
      ticketOnNo: q.ticket_on_no === 1,
      targetIds: new Set(input.questionTargets.filter((t) => t.question_id === q.id).map((t) => t.target_id)),
    });
  if (status && audit.include_marked === 1)
    add("Checks", { key: "marked", kind: "marked", label: "Clearly marked?", group: "Checks", entryId: null });
  if (status && audit.include_map === 1)
    add("Checks", { key: "map", kind: "map", label: "Placed correctly on the map?", group: "Checks", entryId: null });
  add("GPS", { key: "gps", kind: "gps", label: "GPS coordinates", group: "GPS", entryId: null });

  return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({ label: g, items: groups.get(g)! }));
}

export function allKeys(groups: ItemGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.items.map((i) => i.key)));
}

export interface WizardTarget {
  id: string;
  location_id: string | null;
  location_name: string;
  type_name: string | null;
  /** What the Location's status is now, for the confirmation page. */
  status_name?: string | null;
  location_type_id: string | null;
  state: "pending" | "audited" | "not_audited";
  gps_lat: number | null;
  gps_lng: number | null;
}

/** The selected items that actually apply to this target, in group order. */
export function itemsForTarget(groups: ItemGroup[], selection: Set<string>, t: WizardTarget): WizardItem[] {
  const out: WizardItem[] = [];
  let confirm: WizardItem | null = null;
  for (const g of groups)
    for (const item of g.items) {
      if (!selection.has(item.key)) continue;
      // Last, whatever group it was offered under: there is nothing to
      // confirm before the questions have been asked.
      if (item.kind === "confirm") {
        confirm = item;
        continue;
      }
      if (item.typeIds && (!t.location_type_id || !item.typeIds.has(t.location_type_id))) continue;
      if (item.targetIds && !item.targetIds.has(t.id)) continue;
      // A location that already has a pin is not asked for one again.
      if (item.kind === "gps" && t.gps_lat !== null && t.gps_lng !== null) continue;
      out.push(item);
    }
  if (confirm) out.push(confirm);
  return out;
}

export interface Step {
  targetIndex: number;
  itemIndex: number;
  target: WizardTarget;
  item: WizardItem;
}

/** One flat queue: every target in order, each with its applicable items.
 *  Location-major by decision (2026-09-23) - a sweep of one item is just a
 *  run with one item selected. */
export function buildSteps(targets: WizardTarget[], groups: ItemGroup[], selection: Set<string>): Step[] {
  const steps: Step[] = [];
  targets.forEach((target, targetIndex) => {
    itemsForTarget(groups, selection, target).forEach((item, itemIndex) => {
      steps.push({ targetIndex, itemIndex, target, item });
    });
  });
  return steps;
}

/** The first step of a target, for the jump picker. */
export function stepOfTarget(steps: Step[], targetId: string): number {
  const i = steps.findIndex((s) => s.target.id === targetId);
  return i === -1 ? 0 : i;
}

export function filterTargets(
  targets: WizardTarget[],
  query: string,
  state: "all" | "pending" | "audited",
  answered: (targetId: string) => boolean,
): WizardTarget[] {
  const q = query.trim().toLowerCase();
  return targets.filter((t) => {
    if (state === "pending" && (t.state === "audited" || answered(t.id))) return false;
    if (state === "audited" && !(t.state === "audited" || answered(t.id))) return false;
    if (q && !`${t.location_name} ${t.type_name ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ── the answers a run holds (in memory, in this prototype) ───────────────

export interface ServiceAnswer { present: boolean | null; working: boolean; note: string }
export interface AmenityAnswer { present: boolean | null; note: string }
export interface AttributeAnswer { value: string; text: string; note: string }
export type AnswerValue = ServiceAnswer | AmenityAnswer | AttributeAnswer | boolean | string | number | null;
export type TargetAnswers = Record<string, AnswerValue>;
export type Answers = Record<string, TargetAnswers>;

/** Has this item been answered for this target? Drives the progress pips
 *  and the "what is left" counts. */
export function isAnswered(v: AnswerValue | undefined, kind: ItemKind): boolean {
  if (v === undefined || v === null) return false;
  switch (kind) {
    case "service":
      return (v as ServiceAnswer).present !== null;
    case "amenity":
      return (v as AmenityAnswer).present !== null;
    case "attribute": {
      const a = v as AttributeAnswer;
      return a.value.trim() !== "" || a.text.trim() !== "";
    }
    case "question":
      return v !== "" ;
    default:
      return true;
  }
}

export function answeredCount(items: WizardItem[], answers: TargetAnswers | undefined): number {
  if (!answers) return 0;
  return items.filter((i) => isAnswered(answers[i.key], i.kind)).length;
}

/**
 * How much of the run's scroller is actually on screen.
 *
 * The wizard deliberately does NOT shrink the viewport when the keyboard
 * opens - the location pager is allowed to go under it. What must not
 * happen is the question scrolling out of sight: each item's page is a
 * screen, and a screen has just got shorter. This returns the height a
 * page should take, so the question stays centred in what is left.
 *
 * `wrap` is the scroller in layout coordinates (getBoundingClientRect);
 * `view` is the visual viewport, whose height excludes the keyboard and
 * whose offsetTop is how far it has been scrolled inside the layout
 * viewport - iOS moves it, Android does not.
 */
export function visiblePageHeight(
  wrap: { top: number; height: number },
  view: { offsetTop: number; height: number },
): number {
  const visibleBottom = view.offsetTop + view.height;
  // Never collapse to nothing: a freak measurement mid-rotation would
  // otherwise leave a page too short to hold its own control.
  return Math.max(160, Math.min(wrap.height, Math.round(visibleBottom - wrap.top)));
}

/**
 * Is this the same answer as that one?
 *
 * Used to tell a real change from a field that was merely landed on: the
 * run focuses a field when it arrives at its item and the field commits
 * when it loses focus, so scrolling past a number would otherwise write
 * its own value back - and the first write at a Location is what creates
 * the Finding, which is what marks it audited. Scrolling is not auditing.
 */
export function sameAnswer(a: AnswerValue | undefined, b: AnswerValue | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (x[k] !== y[k]) return false;
  return true;
}
