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
  resolveDueBy,
  expectedStartAnchor,
  hideUntilFromAnchor,
  resolveHideUntil,
  sectionsEligibleAtCreation,
  type InstantiableSection,
  type InstantiableTemplate,
} from "../lib/checklists";
import { instanceItemId } from "../lib/checklistUpdate";
import { insertIfAbsent } from "./sql";

// The shapes and the creation rule are pure, and live in src/lib so the
// open-checklist updater can share them; re-exported for existing callers.
export { sectionsEligibleAtCreation };
export type { InstantiableSection, InstantiableTemplate };

/** Deterministic id for a template section's row on a given instance. */
export function sectionInstanceId(
  instanceId: string,
  templateSectionId: string,
): string {
  return deterministicId(`instsection:${instanceId}:${templateSectionId}`);
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
  /** The checklist's expected_start_at, when its template has one. */
  anchor: Date | null = null,
): Promise<string> {
  const sid = sectionInstanceId(instanceId, section.id);
  const hideUntil = anchor
    ? hideUntilFromAnchor(section.hide_until_rule, anchor)
    : resolveHideUntil(section.hide_until_rule, now);
  const dueBy = resolveDueBy(section.dueBy, now);

  await insertIfAbsent(tx, "checklist_instance_sections", sid, {
    instance_id: instanceId,
    template_section_id: section.id,
    label: section.name,
    position: section.position,
    hide_until: hideUntil == null ? null : stamp(hideUntil),
    due_by: dueBy == null ? null : stamp(dueBy),
    location_id: section.location_id ?? null,
    // What an offset Due by counts from, should an update re-resolve it.
    created_at: stamp(now),
  });

  for (const item of section.items) {
    await insertIfAbsent(
      tx,
      "checklist_instance_items",
      instanceItemId(sid, item.id),
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
  // Resolved once, here, and stored: sections added hours from now must date
  // their reveals from the same evening this checklist belongs to.
  const anchored = expectedStartAnchor(template.expected_start, now);
  const anchor = anchored.getTime() === now.getTime() ? null : anchored;
  const hideUntil = anchor
    ? hideUntilFromAnchor(template.hide_until_rule, anchor)
    : resolveHideUntil(template.hide_until_rule, now);
  const dueBy = resolveDueBy(template.dueBy, now);
  const assignToUser = template.assigned_to_user === 1 || !template.assigned_role_id;

  await insertIfAbsent(tx, "checklist_instances", instanceId, {
    template_id: template.id,
    assigned_to_id: assignToUser ? userId : null,
    status: "not_started",
    hide_until: hideUntil == null ? null : stamp(hideUntil),
    expected_start_at: anchor ? stamp(anchor.getTime()) : null,
    due_by: dueBy == null ? null : stamp(dueBy),
    created_at: stamp(now),
  });

  for (const section of sectionsEligibleAtCreation(template.sections, now)) {
    await insertSectionInstance(tx, instanceId, section, now, anchor);
  }
  return instanceId;
}
