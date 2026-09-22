// Audit Rules — the pure evaluator behind an Audit Template's rule tree.
// docs/audits.md § Rules is the spec; src/lib/auditRules.test.ts the cases.
//
// A rule selects Locations with conditions that read subject · verb · value.
// A child rule narrows its parent: it selects only from the parent's
// selection. Questions attach to rules and are asked only of the Locations
// that rule selects. Rules resolve to a fixed target list at launch.

export type Subject =
  | "name"
  | "type"
  | "location"
  | "status"
  | "service"
  | "amenity"
  | "lease"
  | "reservation"
  | "last_audited";

export interface Condition {
  subject: Subject;
  verb: string;
  value: string;
}

export interface RuleNode {
  id: string;
  /** All conditions must hold (and) or any may (or). */
  mode: "all" | "any";
  conditions: Condition[];
  questionIds: string[];
  children: RuleNode[];
}

/** What the evaluator needs to know about a Location. Built by the data layer. */
export interface RuleLocation {
  id: string;
  name: string;
  typeName: string;
  parentId: string | null;
  statusName: string | null;
  isVacancy: boolean;
  tracksStatus: boolean;
  retired: boolean;
  serviceIds: string[];
  amenityIds: string[];
  hasCurrentLease: boolean;
  /** A Reservation in `checked_in`; requested or confirmed do not count. */
  hasActiveReservation: boolean;
  /** ISO date of the last finalized Audit that had a Finding here, per kind. */
  lastAudited: { occupancy: string | null; status: string | null };
}

export type AuditKind = "occupancy" | "status";

export interface Target {
  locationId: string;
  /** Every rule that selected it, outermost first. */
  ruleIds: string[];
  /** Union of those rules' questions, in rule order, each once. */
  questionIds: string[];
}

export interface Resolution {
  /** Selection of every rule, keyed by rule id. */
  selected: Map<string, Set<string>>;
  /** The fixed target list, in tree order. */
  targets: Target[];
}

export const SUBJECT_LABELS: Record<Subject, string> = {
  name: "Name",
  type: "Type",
  location: "Location",
  status: "Status",
  service: "Service",
  amenity: "Amenity",
  lease: "Lease",
  reservation: "Reservation",
  last_audited: "Last audited",
};

export interface Verb {
  key: string;
  label: string;
  needsValue: boolean;
}

/** Verbs per subject. Negation is a verb, never a separate toggle. */
export const VERBS: Record<Subject, Verb[]> = {
  name: [
    { key: "contains", label: "contains", needsValue: true },
    { key: "starts", label: "starts with", needsValue: true },
    { key: "ends", label: "ends with", needsValue: true },
    { key: "is", label: "is", needsValue: true },
    { key: "not_contains", label: "does not contain", needsValue: true },
    { key: "not_ends", label: "does not end with", needsValue: true },
  ],
  type: [
    { key: "is", label: "is", needsValue: true },
    { key: "is_not", label: "is not", needsValue: true },
  ],
  location: [
    { key: "under", label: "is under", needsValue: true },
    { key: "not_under", label: "is not under", needsValue: true },
  ],
  status: [
    { key: "is", label: "is", needsValue: true },
    { key: "is_not", label: "is not", needsValue: true },
    { key: "vacant", label: "counts as vacant", needsValue: false },
    { key: "not_vacant", label: "does not count as vacant", needsValue: false },
  ],
  service: [
    { key: "has", label: "includes", needsValue: true },
    { key: "lacks", label: "does not include", needsValue: true },
  ],
  amenity: [
    { key: "has", label: "includes", needsValue: true },
    { key: "lacks", label: "does not include", needsValue: true },
  ],
  lease: [
    { key: "current", label: "is current", needsValue: false },
    { key: "absent", label: "is absent", needsValue: false },
  ],
  reservation: [
    { key: "active", label: "is active", needsValue: false },
    { key: "absent", label: "is absent", needsValue: false },
  ],
  last_audited: [{ key: "before", label: "before", needsValue: true }],
};

export function verbOf(c: Condition): Verb | undefined {
  return VERBS[c.subject].find((v) => v.key === c.verb);
}

/** A condition whose verb needs a value, and has none, is not a condition yet. */
export function isComplete(c: Condition): boolean {
  const verb = verbOf(c);
  if (!verb) return false;
  return !verb.needsValue || c.value.trim() !== "";
}

function isUnder(loc: RuleLocation, ancestorId: string, byId: Map<string, RuleLocation>): boolean {
  let p = loc.parentId;
  let guard = 0;
  while (p && guard++ < 64) {
    if (p === ancestorId) return true;
    p = byId.get(p)?.parentId ?? null;
  }
  return false;
}

export function conditionMatches(
  c: Condition,
  loc: RuleLocation,
  byId: Map<string, RuleLocation>,
  kind: AuditKind,
): boolean {
  const v = c.value.trim().toLowerCase();
  const n = loc.name.toLowerCase();
  switch (c.subject) {
    case "name":
      switch (c.verb) {
        case "contains":
          return n.includes(v);
        case "starts":
          return n.startsWith(v);
        case "ends":
          return n.endsWith(v);
        case "is":
          return n === v;
        case "not_contains":
          return !n.includes(v);
        case "not_ends":
          return !n.endsWith(v);
      }
      return false;
    case "type":
      return c.verb === "is" ? loc.typeName === c.value : loc.typeName !== c.value;
    case "location":
      return c.verb === "under" ? isUnder(loc, c.value, byId) : !isUnder(loc, c.value, byId);
    case "status":
      switch (c.verb) {
        case "is":
          return loc.statusName === c.value;
        case "is_not":
          return loc.statusName !== c.value;
        case "vacant":
          return loc.isVacancy;
        case "not_vacant":
          return !loc.isVacancy;
      }
      return false;
    case "service":
      return c.verb === "has" ? loc.serviceIds.includes(c.value) : !loc.serviceIds.includes(c.value);
    case "amenity":
      return c.verb === "has" ? loc.amenityIds.includes(c.value) : !loc.amenityIds.includes(c.value);
    case "lease":
      return c.verb === "current" ? loc.hasCurrentLease : !loc.hasCurrentLease;
    case "reservation":
      return c.verb === "active" ? loc.hasActiveReservation : !loc.hasActiveReservation;
    case "last_audited": {
      // "Before <date>": never audited for this kind, or last audited earlier
      // than the date. Audits of the other kind are not evidence.
      const last = loc.lastAudited[kind];
      return last === null || last < c.value;
    }
  }
}

export function ruleMatches(
  rule: RuleNode,
  loc: RuleLocation,
  byId: Map<string, RuleLocation>,
  kind: AuditKind,
): boolean {
  const conditions = rule.conditions.filter(isComplete);
  if (conditions.length === 0) return true;
  return rule.mode === "all"
    ? conditions.every((c) => conditionMatches(c, loc, byId, kind))
    : conditions.some((c) => conditionMatches(c, loc, byId, kind));
}

/** Locations in tree order: parent before children, siblings as supplied. */
export function treeOrder(locations: RuleLocation[]): RuleLocation[] {
  const byParent = new Map<string | null, RuleLocation[]>();
  const ids = new Set(locations.map((l) => l.id));
  for (const l of locations) {
    // A location whose parent isn't in the list is a root for ordering.
    const key = l.parentId && ids.has(l.parentId) ? l.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(l);
    byParent.set(key, list);
  }
  const out: RuleLocation[] = [];
  const walk = (parent: string | null) => {
    for (const l of byParent.get(parent) ?? []) {
      out.push(l);
      walk(l.id);
    }
  };
  walk(null);
  return out;
}

/**
 * Resolve a rule tree into its fixed target list.
 *
 * Retired locations are invisible to every rule. A location whose type does
 * not track status becomes a target only when a rule that selected it names
 * that type with "Type is" — otherwise "under B Dock" would make the dock
 * itself a target beside its slips.
 */
export function resolveTargets(
  roots: RuleNode[],
  locations: RuleLocation[],
  opts: { kind: AuditKind },
): Resolution {
  const live = locations.filter((l) => !l.retired);
  const byId = new Map(live.map((l) => [l.id, l]));
  const selected = new Map<string, Set<string>>();
  const targetMap = new Map<string, Target>();
  const namedByType = new Set<string>();

  const walk = (rule: RuleNode, candidates: RuleLocation[]) => {
    const sel = candidates.filter((l) => ruleMatches(rule, l, byId, opts.kind));
    selected.set(rule.id, new Set(sel.map((l) => l.id)));
    const namesType = rule.conditions.some(
      (c) => c.subject === "type" && c.verb === "is" && isComplete(c),
    );
    for (const loc of sel) {
      const t = targetMap.get(loc.id) ?? { locationId: loc.id, ruleIds: [], questionIds: [] };
      t.ruleIds.push(rule.id);
      for (const q of rule.questionIds) if (!t.questionIds.includes(q)) t.questionIds.push(q);
      targetMap.set(loc.id, t);
      if (namesType) namedByType.add(loc.id);
    }
    for (const child of rule.children) walk(child, sel);
  };
  for (const r of roots) walk(r, live);

  const targets = treeOrder(live)
    .filter((l) => targetMap.has(l.id) && (l.tracksStatus || namedByType.has(l.id)))
    .map((l) => targetMap.get(l.id)!);
  return { selected, targets };
}

/** One-line description: "Location is under BH14 and Name ends with “L”". */
export function describeRule(rule: RuleNode, locationName: (id: string) => string): string {
  const conditions = rule.conditions.filter(isComplete);
  if (conditions.length === 0) return "everything";
  return conditions
    .map((c) => {
      const verb = verbOf(c)!;
      const value = !verb.needsValue
        ? ""
        : c.subject === "location"
          ? locationName(c.value)
          : c.subject === "type" || c.subject === "status" || c.subject === "last_audited"
            ? c.value
            : `“${c.value}”`;
      return `${SUBJECT_LABELS[c.subject]} ${verb.label} ${value}`.trim();
    })
    .join(rule.mode === "all" ? " and " : " or ");
}
