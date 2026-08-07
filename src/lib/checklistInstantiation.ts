// Turning a checklist template into a fully materialized instance: every
// eligible section and all of its items are created as rows in one transact,
// so display logic only ever renders rows — never templates standing in for
// future rows. checkpoint/location/asset sections are the exception, created
// lazily by the same section builder when that thing is actually visited.
//
// All ids are deterministic so any flow that might fire twice (a re-scanned
// checkpoint, two clients racing on the same recurring template) converges on
// the same rows instead of duplicating them.
import { db } from "./db";
import { deterministicId } from "./detId";
import {
  eligibleToday,
  resolveDueBy,
  resolveHideUntil,
  type DueByRule,
  type TemplateItemLike,
} from "./checklists";

export interface InstantiableSection {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  triggerType: string;
  triggerConfig?: Record<string, unknown> | null;
  hideUntilRule?: string | null;
  dueBy?: DueByRule | null;
  location?: { id: string } | null;
  checkpoints?: { id: string }[];
  assets?: { id: string }[];
  items?: TemplateItemLike[];
}

export interface InstantiableTemplate {
  id: string;
  /** Absent (pre-restructure templates) reads as false: role-pool. */
  assignedToUser?: boolean | null;
  hideUntilRule?: string | null;
  dueBy?: DueByRule | null;
  assignedRole?: { id: string } | null;
  sections?: InstantiableSection[];
}

/** Deterministic id for a template section's row on a given instance. */
export function sectionInstanceId(instanceId: string, templateSectionId: string): string {
  return deterministicId(`instsection:${instanceId}:${templateSectionId}`);
}

/**
 * Section rows created with the instance: active, and either always-on
 * (manual) or recurring with today matching. Event-anchored types
 * (checkpoint / location / asset) wait for their event.
 */
export function sectionsEligibleAtCreation(
  sections: InstantiableSection[] | undefined,
  now: Date,
): InstantiableSection[] {
  return (sections ?? []).filter(
    (s) =>
      s.isActive &&
      (s.triggerType === "manual" || s.triggerType === "recurring") &&
      eligibleToday(s, now),
  );
}

/**
 * Transactions materializing one section (row + all its item rows) onto an
 * instance. Location/checkpoint/asset context is copied from the template
 * section, and each item row pins the exact template-item version it was
 * created from — label/type/config are always read back through that link.
 */
export function buildSectionInstanceTx(
  instanceId: string,
  section: InstantiableSection,
  now: Date = new Date(),
) {
  const sid = sectionInstanceId(instanceId, section.id);
  const hideUntil = resolveHideUntil(section.hideUntilRule, now);
  const dueBy = resolveDueBy(section.dueBy, now);
  return [
    db.tx.checklistInstanceSections[sid]
      .update({
        label: section.name,
        order: section.order,
        ...(hideUntil != null ? { hideUntil } : {}),
        ...(dueBy != null ? { dueBy } : {}),
      })
      .link({
        instance: instanceId,
        template: section.id,
        ...(section.location ? { location: section.location.id } : {}),
        ...(section.checkpoints?.length
          ? { checkpoints: section.checkpoints.map((c) => c.id) }
          : {}),
        ...(section.assets?.length ? { assets: section.assets.map((a) => a.id) } : {}),
      }),
    ...(section.items ?? []).map((item) =>
      db.tx.checklistInstanceItems[deterministicId(`institem:${sid}:${item.id}`)]
        .update({ order: item.order })
        .link({ section: sid, template: item.id }),
    ),
  ];
}

/**
 * Transactions materializing a full instance of a template. The caller mints
 * (or deterministically derives) the instance id and records provenance in
 * the activity log — nothing on the instance itself says how it was
 * triggered; the template's triggerType does.
 *
 * Unassigned-for-the-role only when a role is actually linked; a template
 * missing its assignedRole (admin UI enforces one, but belt and braces)
 * falls back to the triggering user rather than creating an instance no
 * query can reach.
 */
export function buildInstanceTx(opts: {
  template: InstantiableTemplate;
  instanceId: string;
  userId: string;
  now?: Date;
}) {
  const { template, instanceId, userId } = opts;
  const now = opts.now ?? new Date();
  const hideUntil = resolveHideUntil(template.hideUntilRule, now);
  const dueBy = resolveDueBy(template.dueBy, now);
  const assignToUser = template.assignedToUser || !template.assignedRole;
  return [
    db.tx.checklistInstances[instanceId]
      .update({
        status: "not_started",
        ...(hideUntil != null ? { hideUntil } : {}),
        ...(dueBy != null ? { dueBy } : {}),
      })
      .link({
        template: template.id,
        ...(assignToUser ? { assignedTo: userId } : {}),
      }),
    ...sectionsEligibleAtCreation(template.sections, now).flatMap((s) =>
      buildSectionInstanceTx(instanceId, s, now),
    ),
  ];
}

/**
 * The query shape instantiation needs on a template — spread into any query
 * whose results feed buildInstanceTx.
 */
export const TEMPLATE_INSTANTIATION_QUERY = {
  assignedRole: {},
  sections: { location: {}, checkpoints: {}, assets: {}, items: {} },
} as const;
