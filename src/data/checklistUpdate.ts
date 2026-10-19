// "Update open checklists": bringing a template's open checklists in line
// with it, after it was edited.
//
// Read here, planned in src/lib/checklistUpdate.ts, written here. The hook and
// the write share the same queries and the same planner, so the number on the
// banner is the number the button will change. The write plans again inside
// its own transaction rather than trusting the hook's plan, since a guard's
// answer can sync in between.
import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import type { LockContext } from "@powersync/web";
import { stamp } from "../lib/db";
import {
  planChecklistUpdate,
  versionLineage,
  type OpenChecklist,
  type OpenItem,
  type OpenSection,
  type UpdateOp,
} from "../lib/checklistUpdate";
import type { InstantiableTemplate } from "../lib/checklists";
import { recordActivity } from "./activity";
import { insertSectionInstance } from "./checklistInstantiation";
import { loadInstantiableTemplate, useInstantiableTemplates } from "./checklists";
import { insertIfAbsent, remove, transact, update, type Executor } from "./sql";

// Nested location-check checklists are included: they are instances of their
// own template like any other.
const OPEN = `SELECT id FROM checklist_instances WHERE template_id = ? AND status <> 'complete'`;

const OPEN_CHECKLISTS = `
  SELECT id, hide_until, due_by, expected_start_at, created_at
    FROM checklist_instances WHERE template_id = ? AND status <> 'complete'`;

// IN rather than JOIN: instance_id and section_id are not `id`, and a join on
// anything but `id` scans the whole table once per outer row (CLAUDE.md).
const OPEN_SECTIONS = `
  SELECT id, instance_id, template_section_id, label, position, location_id,
         hide_until, due_by, created_at
    FROM checklist_instance_sections WHERE instance_id IN (${OPEN})`;

const OPEN_ITEMS = `
  SELECT id, section_id, template_item_id, position, completed_at, result, note
    FROM checklist_instance_items
   WHERE section_id IN (SELECT id FROM checklist_instance_sections WHERE instance_id IN (${OPEN}))`;

// Every superseded version is an orphan, so lineage cannot be filtered by
// template. The table holds one row per version ever written; it is small.
const LINEAGE = `
  SELECT id, previous_version_id FROM checklist_template_items
   WHERE previous_version_id IS NOT NULL`;

type ChecklistRow = Omit<OpenChecklist, "sections">;
type SectionRow = Omit<OpenSection, "items"> & { instance_id: string };
type ItemRow = OpenItem & { section_id: string };
type LineageRow = { id: string; previous_version_id: string | null };

export interface ChecklistPlan {
  checklistId: string;
  ops: UpdateOp[];
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

function planAll(
  template: InstantiableTemplate,
  checklists: ChecklistRow[],
  sections: SectionRow[],
  items: ItemRow[],
  lineageRows: LineageRow[],
  now: Date,
): ChecklistPlan[] {
  const current = template.sections.flatMap((s) => s.items.map((i) => i.id));
  const lineage = versionLineage(lineageRows, current);
  const itemsBySection = groupBy(items, (i) => i.section_id);
  const sectionsByChecklist = groupBy(sections, (s) => s.instance_id);
  return checklists
    .map((c) => {
      const open: OpenChecklist = {
        ...c,
        sections: (sectionsByChecklist.get(c.id) ?? []).map((s) => ({
          ...s,
          items: itemsBySection.get(s.id) ?? [],
        })),
      };
      return { checklistId: c.id, ops: planChecklistUpdate(open, template, lineage, now) };
    })
    .filter((p) => p.ops.length > 0);
}

/**
 * The open checklists of a template that differ from it, each with what an
 * update would do to it. Empty when every one already matches.
 */
export function useOpenChecklistPlans(templateId: string): ChecklistPlan[] {
  const template = useInstantiableTemplates([]).find((t) => t.id === templateId);
  const { data: checklists } = useQuery<ChecklistRow>(OPEN_CHECKLISTS, [templateId]);
  const { data: sections } = useQuery<SectionRow>(OPEN_SECTIONS, [templateId]);
  const { data: items } = useQuery<ItemRow>(OPEN_ITEMS, [templateId]);
  const { data: lineage } = useQuery<LineageRow>(LINEAGE);
  return useMemo(
    () =>
      template ? planAll(template, checklists, sections, items, lineage, new Date()) : [],
    [template, checklists, sections, items, lineage],
  );
}

async function loadPlans(
  tx: Executor,
  template: InstantiableTemplate,
  now: Date,
): Promise<ChecklistPlan[]> {
  return planAll(
    template,
    await tx.getAll<ChecklistRow>(OPEN_CHECKLISTS, [template.id]),
    await tx.getAll<SectionRow>(OPEN_SECTIONS, [template.id]),
    await tx.getAll<ItemRow>(OPEN_ITEMS, [template.id]),
    await tx.getAll<LineageRow>(LINEAGE),
    now,
  );
}

const when = (ms: number | null | undefined) =>
  ms === undefined ? undefined : ms === null ? null : stamp(ms);

async function apply(
  tx: LockContext,
  template: InstantiableTemplate,
  checklistId: string,
  op: UpdateOp,
  now: Date,
): Promise<void> {
  switch (op.op) {
    case "setChecklistTimes":
      return update(tx, "checklist_instances", op.checklistId, {
        hide_until: when(op.hide_until),
        due_by: when(op.due_by),
      });
    case "updateSection": {
      const { hide_until, due_by, ...rest } = op.changes;
      return update(tx, "checklist_instance_sections", op.sectionId, {
        ...rest,
        hide_until: when(hide_until),
        due_by: when(due_by),
      });
    }
    case "addSection": {
      const section = template.sections.find((s) => s.id === op.templateSectionId);
      if (!section) return;
      const row = await tx.getOptional<{ expected_start_at: string | null }>(
        "SELECT expected_start_at FROM checklist_instances WHERE id = ?",
        [checklistId],
      );
      const anchor = row?.expected_start_at ? new Date(row.expected_start_at) : null;
      await insertSectionInstance(tx, checklistId, section, now, anchor);
      return;
    }
    case "removeSection":
      // Items first: the device's tables have no cascade, so a section
      // removed alone would leave its items behind until the next sync.
      await tx.execute("DELETE FROM checklist_instance_items WHERE section_id = ?", [op.sectionId]);
      return remove(tx, "checklist_instance_sections", op.sectionId);
    case "repointItem":
      return update(tx, "checklist_instance_items", op.itemId, {
        template_item_id: op.templateItemId,
      });
    case "addItem":
      await insertIfAbsent(tx, "checklist_instance_items", op.itemId, {
        section_id: op.sectionId,
        template_item_id: op.templateItemId,
        position: op.position,
      });
      return;
    case "removeItem":
      return remove(tx, "checklist_instance_items", op.itemId);
  }
}

/**
 * Apply a template's current state to every open checklist that differs from
 * it, in one transaction, logging each. Returns how many changed.
 */
export function updateOpenChecklists(templateId: string, actorId: string | null): Promise<number> {
  return transact(async (tx) => {
    const now = new Date();
    const template = await loadInstantiableTemplate(tx, templateId);
    if (!template) return 0;
    const plans = await loadPlans(tx, template, now);
    for (const plan of plans) {
      for (const op of plan.ops) await apply(tx, template, plan.checklistId, op, now);
      await recordActivity(tx, {
        eventType: "checklist.updated",
        summary: `${template.name} updated to match its template`,
        subjectType: "checklist_instances",
        subjectId: plan.checklistId,
        actorId,
      });
    }
    return plans.length;
  });
}
