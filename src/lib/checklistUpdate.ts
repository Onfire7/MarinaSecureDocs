// Bringing an open checklist in line with its template, after the template
// was edited.
//
// A checklist is a materialized copy: editing the template changes nothing
// already generated. "Update open checklists" (the builder's banner) plans,
// per checklist, what would make it what the template produces NOW — minus
// anything already answered, which keeps the question it was answered
// against. The rules are in AdminChecklistTemplatesPage.spec.md, numbered;
// the comments below cite them.
//
// Pure: the data layer loads rows, this plans, the data layer writes. An empty
// plan means the checklist already matches, which is also what decides
// whether the banner shows at all.
import { deterministicId } from "./detId";
import {
  hideUntilFromAnchor,
  resolveDueBy,
  resolveHideUntil,
  sectionsEligibleAtCreation,
  type DueByRule,
  type InstantiableSection,
  type InstantiableTemplate,
} from "./checklists";

/** Deterministic id for a template item's row on an instance section. */
export function instanceItemId(instanceSectionId: string, templateItemId: string): string {
  return deterministicId(`institem:${instanceSectionId}:${templateItemId}`);
}

type Stamp = string | number | null;

export interface OpenItem {
  id: string;
  template_item_id: string | null;
  position: number;
  completed_at: Stamp;
  result: string | null;
  note: string | null;
}

export interface OpenSection {
  id: string;
  template_section_id: string | null;
  label: string;
  position: number;
  location_id: string | null;
  hide_until: Stamp;
  due_by: Stamp;
  /** Null on rows created before the column existed. */
  created_at: Stamp;
  items: OpenItem[];
}

export interface OpenChecklist {
  id: string;
  hide_until: Stamp;
  due_by: Stamp;
  expected_start_at: Stamp;
  created_at: Stamp;
  sections: OpenSection[];
}

/** Times are epoch ms; null clears. A key is present only when it changes. */
interface Times {
  hide_until?: number | null;
  due_by?: number | null;
}

export type UpdateOp =
  | ({ op: "setChecklistTimes"; checklistId: string } & Times)
  | {
      op: "updateSection";
      sectionId: string;
      changes: { label?: string; position?: number; location_id?: string | null } & Times;
    }
  | { op: "addSection"; checklistId: string; templateSectionId: string }
  | { op: "removeSection"; sectionId: string }
  | { op: "repointItem"; itemId: string; templateItemId: string }
  | {
      op: "addItem";
      sectionId: string;
      itemId: string;
      templateItemId: string;
      position: number;
    }
  | { op: "removeItem"; itemId: string };

/**
 * Map every template item id to the version that is current now.
 *
 * Editing a referenced item writes a new row whose previous_version_id names
 * the old one, so walking that chain backwards from each current item reaches
 * every version an instance can still point at. Current items map to
 * themselves; a version whose chain ends nowhere current is absent, meaning
 * the item was removed.
 */
export function versionLineage(
  rows: { id: string; previous_version_id: string | null }[],
  currentIds: Iterable<string>,
): Map<string, string> {
  const previous = new Map(rows.map((r) => [r.id, r.previous_version_id]));
  const lineage = new Map<string, string>();
  for (const current of currentIds) {
    // `seen` guards against a cycle, which the schema does not forbid.
    for (let id: string | null | undefined = current; id && !lineage.has(id); id = previous.get(id)) {
      lineage.set(id, current);
    }
  }
  return lineage;
}

/** Rule 1: an answer, a note, or a nested checklist started from it. */
export function isAnswered(item: OpenItem): boolean {
  return item.completed_at != null || item.result != null || !!item.note;
}

const ms = (s: Stamp): number | null => (s == null ? null : new Date(s).getTime());
const isHidden = (hideUntil: Stamp, now: Date) => {
  const at = ms(hideUntil);
  return at != null && at > now.getTime();
};

/**
 * Rule 9: Hide until and Due by, re-resolved exactly as at creation, for a row
 * that is still hidden. Returns only what differs.
 */
function retime(
  row: { hide_until: Stamp; due_by: Stamp; created_at: Stamp },
  rules: { hide_until_rule?: string | null; dueBy?: DueByRule | null },
  anchor: Date | null,
  now: Date,
): Times {
  if (!isHidden(row.hide_until, now)) return {};
  const created = row.created_at == null ? null : new Date(row.created_at);
  const changes: Times = {};
  // Without a creation time, rolling forward from now gives the same answer
  // as rolling forward from creation for anything not yet revealed.
  const hide = anchor
    ? hideUntilFromAnchor(rules.hide_until_rule, anchor)
    : resolveHideUntil(rules.hide_until_rule, created ?? now);
  if (hide !== ms(row.hide_until)) changes.hide_until = hide;
  // An offset is measured from creation, which is unknowable without it.
  if (created) {
    const due = resolveDueBy(rules.dueBy, created);
    if (due !== ms(row.due_by)) changes.due_by = due;
  }
  return changes;
}

export function planChecklistUpdate(
  checklist: OpenChecklist,
  template: InstantiableTemplate,
  lineage: Map<string, string>,
  now: Date = new Date(),
): UpdateOp[] {
  const ops: UpdateOp[] = [];
  const anchor = checklist.expected_start_at == null ? null : new Date(checklist.expected_start_at);

  const times = retime(checklist, template, anchor, now);
  if (Object.keys(times).length) {
    ops.push({ op: "setChecklistTimes", checklistId: checklist.id, ...times });
  }

  const templateSections = new Map(template.sections.map((s) => [s.id, s]));
  const present = new Set<string>();

  for (const section of checklist.sections) {
    const source = section.template_section_id
      ? templateSections.get(section.template_section_id)
      : undefined;
    if (section.template_section_id) present.add(section.template_section_id);

    // Rule 8.
    if (!source || source.is_active !== 1) {
      if (!section.items.some(isAnswered)) {
        ops.push({ op: "removeSection", sectionId: section.id });
      }
      continue;
    }

    // Rules 6 and 9.
    const changes: Extract<UpdateOp, { op: "updateSection" }>["changes"] = {};
    if (section.label !== source.name) changes.label = source.name;
    if (section.position !== source.position) changes.position = source.position;
    if ((section.location_id ?? null) !== (source.location_id ?? null)) {
      changes.location_id = source.location_id ?? null;
    }
    Object.assign(changes, retime(section, source, anchor, now));
    if (Object.keys(changes).length) {
      ops.push({ op: "updateSection", sectionId: section.id, changes });
    }

    ops.push(...planItems(section, source, lineage));
  }

  // Rule 7. Recurrence is judged on the day the checklist was created.
  const day = checklist.created_at == null ? now : new Date(checklist.created_at);
  for (const s of sectionsEligibleAtCreation(template.sections, day)) {
    if (!present.has(s.id)) {
      ops.push({ op: "addSection", checklistId: checklist.id, templateSectionId: s.id });
    }
  }
  return ops;
}

/** Rules 1–5, for one section the checklist and template both have. */
function planItems(
  section: OpenSection,
  source: InstantiableSection,
  lineage: Map<string, string>,
): UpdateOp[] {
  const ops: UpdateOp[] = [];
  const current = new Set(source.items.map((i) => i.id));
  const covered = new Set<string>();

  for (const item of section.items) {
    const tid = item.template_item_id;
    const latest = tid == null ? undefined : (lineage.get(tid) ?? tid);
    const live = latest !== undefined && current.has(latest) ? latest : undefined;

    if (isAnswered(item)) {
      // Kept as asked. Its current version counts as present, so the edit
      // does not also arrive as a second, unanswered copy.
      if (live) covered.add(live);
      continue;
    }
    if (!live || covered.has(live)) {
      ops.push({ op: "removeItem", itemId: item.id });
      continue;
    }
    covered.add(live);
    if (live !== tid) ops.push({ op: "repointItem", itemId: item.id, templateItemId: live });
  }

  for (const item of source.items) {
    if (covered.has(item.id)) continue;
    ops.push({
      op: "addItem",
      sectionId: section.id,
      itemId: instanceItemId(section.id, item.id),
      templateItemId: item.id,
      position: item.position,
    });
  }
  return ops;
}
