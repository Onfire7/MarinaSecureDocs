import { useQuery } from "@powersync/react";
import { db, json, stamp } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";
import type {
  DueByRule,
  ItemConfig,
  ItemResult,
  ItemType,
  TriggerConfig,
} from "../lib/checklists";

// Checklists — templates, and the instances made from them.
//
// A template is authored once and instantiated many times. Instance rows COPY
// their label and position rather than pointing at the template's, so editing a
// template does not rewrite the history of every round already walked. The
// template link survives for provenance, and template items version themselves
// on edit (`previous_version_id`) for the same reason — which is why
// checklist_template_items.section_id is nullable: an orphaned prior version is
// a record of what an item used to say, and five of them exist in this marina's
// real data.

export interface TemplateRow {
  id: string;
  name: string;
  trigger_type: string;
  trigger_config: string | null;
  assigned_role_id: string | null;
  assigned_to_user: number;
  hide_until_rule: string | null;
  due_by: string | null;
  creator_id: string | null;
  assigned_role_name: string | null;
  creator_name: string | null;
  section_count: number;
}

const TEMPLATE_SELECT = `
  SELECT t.*, r.name AS assigned_role_name, u.name AS creator_name,
         (SELECT COUNT(*) FROM checklist_template_sections s
           WHERE s.template_id = t.id) AS section_count
    FROM checklist_templates t
    LEFT JOIN roles r ON r.id = t.assigned_role_id
    LEFT JOIN users u ON u.id = t.creator_id`;

export function useTemplates() {
  return useQuery<TemplateRow>(`${TEMPLATE_SELECT} ORDER BY t.name`);
}

export function useTemplate(templateId: string | undefined) {
  const { data, isLoading } = useQuery<TemplateRow>(
    `${TEMPLATE_SELECT} WHERE t.id = ?`,
    [templateId ?? ""],
  );
  return { template: data[0] ?? null, isLoading };
}

/** Which roles may see a template, beyond the role it is assigned to. */
export function useTemplateViewerRoles() {
  return useQuery<{ id: string; template_id: string; role_id: string }>(
    "SELECT * FROM template_viewer_roles",
  );
}

export interface TemplateSectionRow {
  id: string;
  template_id: string;
  name: string;
  position: number;
  is_active: number;
  trigger_type: string;
  trigger_config: string | null;
  hide_until_rule: string | null;
  due_by: string | null;
  location_id: string | null;
  template_name: string | null;
  location_name: string | null;
}

const SECTION_SELECT = `
  SELECT s.*, t.name AS template_name, l.name AS location_name
    FROM checklist_template_sections s
    LEFT JOIN checklist_templates t ON t.id = s.template_id
    LEFT JOIN locations l ON l.id = s.location_id`;

export function useTemplateSections(templateId?: string) {
  return useQuery<TemplateSectionRow>(
    templateId
      ? `${SECTION_SELECT} WHERE s.template_id = ? ORDER BY s.position`
      : `${SECTION_SELECT} ORDER BY s.template_id, s.position`,
    templateId ? [templateId] : [],
  );
}

/** Sections that fire at a checkpoint — what a guard standing there will do. */
export function useSectionsForCheckpoint(checkpointId: string | undefined) {
  return useQuery<TemplateSectionRow>(
    `${SECTION_SELECT}
       JOIN template_section_checkpoints sc ON sc.section_id = s.id
      WHERE sc.checkpoint_id = ? ORDER BY s.position`,
    [checkpointId ?? ""],
  );
}

export function useSectionCheckpoints() {
  return useQuery<{ id: string; section_id: string; checkpoint_id: string }>(
    "SELECT * FROM template_section_checkpoints",
  );
}

export function useSectionAssets() {
  return useQuery<{ id: string; section_id: string; asset_id: string }>(
    "SELECT * FROM template_section_assets",
  );
}

export interface TemplateItemRow {
  id: string;
  section_id: string | null;
  type: ItemType;
  label: string;
  config: string | null;
  position: number;
  version: number;
  previous_version_id: string | null;
}

/**
 * A section's live items.
 *
 * `section_id IS NOT NULL` is the filter that hides superseded versions: an
 * edited item is replaced by a new row and the old one is orphaned rather than
 * deleted, so the instances that already reference it still read correctly.
 */
export function useTemplateItems(sectionId?: string) {
  return useQuery<TemplateItemRow>(
    sectionId
      ? "SELECT * FROM checklist_template_items WHERE section_id = ? ORDER BY position"
      : "SELECT * FROM checklist_template_items WHERE section_id IS NOT NULL ORDER BY section_id, position",
    sectionId ? [sectionId] : [],
  );
}

export function itemConfig(row: TemplateItemRow): ItemConfig {
  return json<ItemConfig>(row.config, {} as ItemConfig);
}

export function templateTriggerConfig(row: {
  trigger_config: string | null;
}): TriggerConfig {
  return json<TriggerConfig>(row.trigger_config, {} as TriggerConfig);
}

export function dueByRule(row: { due_by: string | null }): DueByRule | null {
  return json<DueByRule | null>(row.due_by, null);
}

// ---------------------------------------------------------------- instances

export interface InstanceRow {
  id: string;
  template_id: string | null;
  assigned_to_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  hide_until: string | null;
  due_by: string | null;
  parent_item_id: string | null;
  template_name: string | null;
  assignee_name: string | null;
  item_count: number;
  done_count: number;
}

const INSTANCE_SELECT = `
  SELECT i.*, t.name AS template_name, u.name AS assignee_name,
         (SELECT COUNT(*) FROM checklist_instance_items ii
            JOIN checklist_instance_sections isec ON isec.id = ii.section_id
           WHERE isec.instance_id = i.id) AS item_count,
         (SELECT COUNT(*) FROM checklist_instance_items ii
            JOIN checklist_instance_sections isec ON isec.id = ii.section_id
           WHERE isec.instance_id = i.id AND ii.completed_at IS NOT NULL)
           AS done_count
    FROM checklist_instances i
    LEFT JOIN checklist_templates t ON t.id = i.template_id
    LEFT JOIN users u ON u.id = i.assigned_to_id`;

export function useInstances() {
  return useQuery<InstanceRow>(
    `${INSTANCE_SELECT} ORDER BY COALESCE(i.due_by, i.started_at) DESC`,
  );
}

export function useInstance(instanceId: string | undefined) {
  const { data, isLoading } = useQuery<InstanceRow>(
    `${INSTANCE_SELECT} WHERE i.id = ?`,
    [instanceId ?? ""],
  );
  return { instance: data[0] ?? null, isLoading };
}

export interface InstanceSectionRow {
  id: string;
  instance_id: string;
  template_section_id: string | null;
  label: string;
  position: number;
  hide_until: string | null;
  due_by: string | null;
  location_id: string | null;
  location_name: string | null;
}

export function useInstanceSections(instanceId: string | undefined) {
  return useQuery<InstanceSectionRow>(
    `SELECT s.*, l.name AS location_name
       FROM checklist_instance_sections s
       LEFT JOIN locations l ON l.id = s.location_id
      WHERE s.instance_id = ? ORDER BY s.position`,
    [instanceId ?? ""],
  );
}

export interface InstanceItemRow {
  id: string;
  section_id: string;
  template_item_id: string | null;
  position: number;
  completed_at: string | null;
  completed_by_id: string | null;
  result: string | null;
  note: string | null;
  /** Copied from the template item at instantiation, so edits do not rewrite history. */
  type: ItemType;
  label: string;
  config: string | null;
  completed_by_name: string | null;
}

const INSTANCE_ITEM_SELECT = `
  SELECT ii.*, ti.type, ti.label, ti.config, u.name AS completed_by_name
    FROM checklist_instance_items ii
    LEFT JOIN checklist_template_items ti ON ti.id = ii.template_item_id
    LEFT JOIN users u ON u.id = ii.completed_by_id`;

export function useInstanceItems(instanceId: string | undefined) {
  return useQuery<InstanceItemRow>(
    `${INSTANCE_ITEM_SELECT}
       JOIN checklist_instance_sections s ON s.id = ii.section_id
      WHERE s.instance_id = ? ORDER BY s.position, ii.position`,
    [instanceId ?? ""],
  );
}

export function itemResult(row: InstanceItemRow): ItemResult | null {
  return json<ItemResult | null>(row.result, null);
}

/** Record an answer against one instance item. */
export async function completeItem(
  itemId: string,
  result: ItemResult | null,
  note: string | null,
  actorId: string | null,
): Promise<void> {
  await update(db, "checklist_instance_items", itemId, {
    result: result === null ? null : JSON.stringify(result),
    note,
    // Clearing an answer clears who gave it — otherwise an item reads as
    // unanswered while still naming the person who last touched it.
    completed_at: result === null ? null : stamp(),
    completed_by_id: result === null ? null : actorId,
  });
}

export async function startInstance(
  instance: { id: string; template_name: string | null },
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "checklist_instances", instance.id, {
      status: "in_progress",
      started_at: stamp(),
      assigned_to_id: actorId,
    });
    await recordActivity(tx, {
      eventType: "checklist.started",
      summary: `"${instance.template_name ?? "Checklist"}" started`,
      subjectType: "checklist_instances",
      subjectId: instance.id,
      actorId,
    });
  });
}

export async function completeInstance(
  instance: { id: string; template_name: string | null },
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "checklist_instances", instance.id, {
      status: "complete",
      completed_at: stamp(),
    });
    await recordActivity(tx, {
      eventType: "checklist.completed",
      summary: `"${instance.template_name ?? "Checklist"}" completed`,
      subjectType: "checklist_instances",
      subjectId: instance.id,
      actorId,
    });
  });
}

// ---------------------------------------------------------------- authoring

export interface TemplateInput {
  name: string;
  triggerType: string;
  triggerConfig?: TriggerConfig | null;
  assignedRoleId?: string | null;
  assignedToUser?: boolean;
  hideUntilRule?: string | null;
  dueBy?: DueByRule | null;
  creatorId?: string | null;
}

function templateColumns(input: Partial<TemplateInput>) {
  return {
    name: input.name,
    trigger_type: input.triggerType,
    trigger_config:
      input.triggerConfig === undefined ? undefined : JSON.stringify(input.triggerConfig),
    assigned_role_id: input.assignedRoleId === undefined ? undefined : input.assignedRoleId,
    assigned_to_user:
      input.assignedToUser === undefined ? undefined : input.assignedToUser ? 1 : 0,
    hide_until_rule: input.hideUntilRule === undefined ? undefined : input.hideUntilRule,
    due_by: input.dueBy === undefined ? undefined : JSON.stringify(input.dueBy),
    creator_id: input.creatorId === undefined ? undefined : input.creatorId,
  };
}

export function createTemplate(input: TemplateInput): Promise<string> {
  return insert(db, "checklist_templates", templateColumns(input));
}

export function saveTemplate(
  templateId: string,
  input: Partial<TemplateInput>,
): Promise<void> {
  return update(db, "checklist_templates", templateId, templateColumns(input));
}

export function deleteTemplate(templateId: string): Promise<void> {
  return remove(db, "checklist_templates", templateId);
}

export interface SectionInput {
  templateId: string;
  name: string;
  position: number;
  isActive?: boolean;
  triggerType: string;
  triggerConfig?: TriggerConfig | null;
  hideUntilRule?: string | null;
  dueBy?: DueByRule | null;
  locationId?: string | null;
}

function sectionColumns(input: Partial<SectionInput>) {
  return {
    template_id: input.templateId,
    name: input.name,
    position: input.position,
    is_active: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
    trigger_type: input.triggerType,
    trigger_config:
      input.triggerConfig === undefined ? undefined : JSON.stringify(input.triggerConfig),
    hide_until_rule: input.hideUntilRule === undefined ? undefined : input.hideUntilRule,
    due_by: input.dueBy === undefined ? undefined : JSON.stringify(input.dueBy),
    location_id: input.locationId === undefined ? undefined : input.locationId,
  };
}

export function createSection(input: SectionInput): Promise<string> {
  return insert(db, "checklist_template_sections", sectionColumns(input));
}

export function saveSection(
  sectionId: string,
  input: Partial<SectionInput>,
): Promise<void> {
  return update(db, "checklist_template_sections", sectionId, sectionColumns(input));
}

export function deleteSection(sectionId: string): Promise<void> {
  return remove(db, "checklist_template_sections", sectionId);
}

export function createItem(input: {
  sectionId: string;
  type: ItemType;
  label: string;
  config: ItemConfig;
  position: number;
}): Promise<string> {
  return insert(db, "checklist_template_items", {
    section_id: input.sectionId,
    type: input.type,
    label: input.label,
    config: JSON.stringify(input.config),
    position: input.position,
    version: 1,
  });
}

/**
 * Edit a template item by superseding it.
 *
 * The old row is not updated and not deleted: it is orphaned from its section
 * and left in place, because instances already reference it and their history
 * must keep reading as it did when it was walked. The new row records what it
 * replaced.
 */
export async function reviseItem(
  existing: TemplateItemRow,
  changes: { type: ItemType; label: string; config: ItemConfig },
): Promise<string> {
  return transact(async (tx) => {
    const newId = await insert(tx, "checklist_template_items", {
      section_id: existing.section_id,
      type: changes.type,
      label: changes.label,
      config: JSON.stringify(changes.config),
      position: existing.position,
      version: existing.version + 1,
      previous_version_id: existing.id,
    });
    await update(tx, "checklist_template_items", existing.id, { section_id: null });
    return newId;
  });
}

export function deleteItem(itemId: string): Promise<void> {
  return remove(db, "checklist_template_items", itemId);
}

export async function reorderItems(itemIds: string[]): Promise<void> {
  await transact(async (tx) => {
    for (const [position, itemId] of itemIds.entries()) {
      await update(tx, "checklist_template_items", itemId, { position });
    }
  });
}

export async function reorderSections(sectionIds: string[]): Promise<void> {
  await transact(async (tx) => {
    for (const [position, sectionId] of sectionIds.entries()) {
      await update(tx, "checklist_template_sections", sectionId, { position });
    }
  });
}

export async function setSectionCheckpoints(
  sectionId: string,
  checkpointIds: string[],
): Promise<void> {
  await replaceLinks(
    "template_section_checkpoints",
    "section_id",
    sectionId,
    "checkpoint_id",
    checkpointIds,
  );
}

export async function setSectionAssets(
  sectionId: string,
  assetIds: string[],
): Promise<void> {
  await replaceLinks(
    "template_section_assets",
    "section_id",
    sectionId,
    "asset_id",
    assetIds,
  );
}

export async function setTemplateViewerRoles(
  templateId: string,
  roleIds: string[],
): Promise<void> {
  await replaceLinks(
    "template_viewer_roles",
    "template_id",
    templateId,
    "role_id",
    roleIds,
  );
}

/**
 * Make a join table's rows for one owner exactly `targetIds`.
 *
 * Differential rather than delete-and-reinsert: every write here is a
 * replication event, and rewriting an unchanged link would push it to every
 * device that holds it for no reason.
 */
async function replaceLinks(
  table: string,
  ownerColumn: string,
  ownerId: string,
  targetColumn: string,
  targetIds: string[],
): Promise<void> {
  await transact(async (tx) => {
    const existing = await tx.getAll<Record<string, string>>(
      `SELECT id, ${targetColumn} FROM ${table} WHERE ${ownerColumn} = ?`,
      [ownerId],
    );
    for (const row of existing) {
      if (!targetIds.includes(row[targetColumn])) await remove(tx, table, row.id);
    }
    for (const targetId of targetIds) {
      if (!existing.some((e) => e[targetColumn] === targetId)) {
        await insert(tx, table, { [ownerColumn]: ownerId, [targetColumn]: targetId });
      }
    }
  });
}
