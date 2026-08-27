// Turning a checklist template into a fully materialized instance: every
// eligible section and all of its items become rows in one transaction, so
// display logic only ever renders rows — never templates standing in for
// future rows. Checkpoint, location and asset sections are the exception,
// created lazily by the same section builder when that thing is actually
// visited.
//
// All ids are deterministic so any flow that might fire twice — a re-scanned
// checkpoint, two clients racing on the same recurring template — converges on
// the same rows instead of duplicating them. That mattered under InstantDB and
// matters more now: PowerSync's upload connector upserts by id, so a replayed
// write queue produces the same rows rather than a second checklist.
import type { LockContext } from "@powersync/web";
import { deterministicId } from "../lib/detId";
import { stamp } from "../lib/db";
import {
  eligibleToday,
  resolveDueBy,
  resolveHideUntil,
  sectionEnabledByStatus,
  type DueByRule,
  type TemplateItemLike,
  type TriggerConfig,
} from "../lib/checklists";
import { insertIfAbsent } from "./sql";

/**
 * A template section with everything instantiation needs about it.
 *
 * Assembled by the data layer from four tables — the section, the status of
 * the location it belongs to, its checkpoint and asset links, and its items —
 * because a section's eligibility depends on all of them and none of them is
 * on the section row.
 */
export interface InstantiableSection {
  id: string;
  name: string;
  position: number;
  is_active: number;
  trigger_type: string;
  triggerConfig?: TriggerConfig | null;
  hide_until_rule?: string | null;
  dueBy?: DueByRule | null;
  location_id?: string | null;
  /** For "location_status" gating; see checklists.ts. */
  location_status_name?: string | null;
  checkpointIds: string[];
  assetIds: string[];
  items: TemplateItemLike[];
}

export interface InstantiableTemplate {
  id: string;
  name: string;
  /** What creates instances of it — clock_in, recurring, checkpoint, … */
  trigger_type: string;
  /** Its own recurrence gate: a checkpoint template can be Tuesdays-only. */
  triggerConfig?: TriggerConfig | null;
  /** Absent reads as false: the instance belongs to the role pool. */
  assigned_to_user?: number | null;
  hide_until_rule?: string | null;
  dueBy?: DueByRule | null;
  assigned_role_id?: string | null;
  sections: InstantiableSection[];
}

/** Deterministic id for a template section's row on a given instance. */
export function sectionInstanceId(
  instanceId: string,
  templateSectionId: string,
): string {
  return deterministicId(`instsection:${instanceId}:${templateSectionId}`);
}

/**
 * Section rows created with the instance: active, and either always-on
 * (manual), recurring with today matching, or gated on the current status of
 * the place they belong to. Event-anchored types — checkpoint, location,
 * asset — wait for their event.
 */
export function sectionsEligibleAtCreation(
  sections: InstantiableSection[],
  now: Date,
): InstantiableSection[] {
  return sections.filter((s) => {
    if (s.is_active !== 1) return false;
    if (s.trigger_type === "location_status") {
      // No location, nothing to read a status from, so nothing to switch it
      // on — the builder warns about this while the template is written.
      return sectionEnabledByStatus(
        s.triggerConfig?.statuses,
        s.location_status_name,
      );
    }
    return (
      (s.trigger_type === "manual" || s.trigger_type === "recurring") &&
      eligibleToday(s, now)
    );
  });
}

/**
 * Whether generating this template right now would produce any work.
 *
 * A checklist with nothing in it is noise on someone's list, and with
 * status-gated sections that is a normal outcome rather than a misconfigured
 * one — a dock round for occupied slips has nothing to do on a night when they
 * are all empty. Callers that generate a checklist *ahead* of the work (clock
 * in/out, manual, recurring) check this first.
 *
 * Deliberately not folded into instantiate(): a checkpoint scan creates an
 * instance and the section that brought it into being in the same transaction,
 * so "no eligible sections at creation" is the wrong question there.
 */
export function hasWorkAtCreation(
  template: InstantiableTemplate,
  now: Date = new Date(),
): boolean {
  return sectionsEligibleAtCreation(template.sections, now).length > 0;
}

/**
 * Materialize one section — its row plus all its item rows — onto an instance.
 *
 * Each item row pins the exact template-item version it was created from, and
 * label, type and config are always read back through that link. That is what
 * makes editing a template safe: the edit supersedes the item rather than
 * changing it, and every instance already pointing at the old version keeps
 * reading what was actually walked.
 */
export async function insertSectionInstance(
  tx: LockContext,
  instanceId: string,
  section: InstantiableSection,
  now: Date = new Date(),
): Promise<string> {
  const sid = sectionInstanceId(instanceId, section.id);
  const hideUntil = resolveHideUntil(section.hide_until_rule, now);
  const dueBy = resolveDueBy(section.dueBy, now);

  await insertIfAbsent(tx, "checklist_instance_sections", sid, {
    instance_id: instanceId,
    template_section_id: section.id,
    label: section.name,
    position: section.position,
    hide_until: hideUntil == null ? null : stamp(hideUntil),
    due_by: dueBy == null ? null : stamp(dueBy),
    location_id: section.location_id ?? null,
  });

  for (const item of section.items) {
    await insertIfAbsent(
      tx,
      "checklist_instance_items",
      deterministicId(`institem:${sid}:${item.id}`),
      { section_id: sid, template_item_id: item.id, position: item.position },
    );
  }
  return sid;
}

/**
 * Materialize a full instance of a template.
 *
 * The caller mints (or deterministically derives) the instance id and records
 * provenance in the activity log — nothing on the instance itself says how it
 * was triggered; the template's trigger_type does.
 *
 * Assignment goes to the triggering user when the template says so, and also
 * when it names no role at all: an instance assigned to nobody, for a role that
 * does not exist, is one no query can reach.
 */
export async function insertInstance(
  tx: LockContext,
  opts: {
    template: InstantiableTemplate;
    instanceId: string;
    userId: string;
    now?: Date;
  },
): Promise<string> {
  const { template, instanceId, userId } = opts;
  const now = opts.now ?? new Date();
  const hideUntil = resolveHideUntil(template.hide_until_rule, now);
  const dueBy = resolveDueBy(template.dueBy, now);
  const assignToUser = template.assigned_to_user === 1 || !template.assigned_role_id;

  await insertIfAbsent(tx, "checklist_instances", instanceId, {
    template_id: template.id,
    assigned_to_id: assignToUser ? userId : null,
    status: "not_started",
    hide_until: hideUntil == null ? null : stamp(hideUntil),
    due_by: dueBy == null ? null : stamp(dueBy),
  });

  for (const section of sectionsEligibleAtCreation(template.sections, now)) {
    await insertSectionInstance(tx, instanceId, section, now);
  }
  return instanceId;
}
