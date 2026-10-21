// Asset triggers — the pure half
// (src/pages/admin/AdminChecklistTemplatesPage.spec.md § Asset triggers).
//
// Checking an Asset out or in is an event a checklist responds to, as a
// checkpoint scan is: sections watching the asset for that event are added
// to the holder's open checklist from their template, or, for a template
// triggered by the event itself, make a new checklist for the holder.
import { deterministicId } from "./detId";
import {
  eligibleToday,
  type AssetEvent,
  type InstantiableSection,
  type InstantiableTemplate,
} from "./checklists";

export interface AssetTriggerPlan {
  /** Sections for checklists the holder already has open. */
  add: { instanceId: string; section: InstantiableSection }[];
  /** New checklists for the holder, holding just the triggered sections. */
  create: { template: InstantiableTemplate; instanceId: string; sections: InstantiableSection[] }[];
}

/**
 * Derived from the checkout and the event, so a replayed write queue rebuilds
 * the same checklist rather than a second one, and an undo can find it.
 */
export function assetTriggerInstanceId(checkoutId: string, event: AssetEvent, templateId: string): string {
  return deterministicId(`asset-trigger:${checkoutId}:${event}:${templateId}`);
}

export function watches(section: InstantiableSection, assetId: string, event: AssetEvent): boolean {
  return (
    Boolean(section.is_active) &&
    section.trigger_type === "asset" &&
    section.assetIds.includes(assetId) &&
    (section.triggerConfig?.event ?? "check_out") === event
  );
}

export function planAssetTrigger(input: {
  event: AssetEvent;
  assetId: string;
  checkoutId: string;
  /** The marina user holding the asset; null for a checkout to a guest. */
  holderUserId: string | null;
  templates: InstantiableTemplate[];
  /** The holder's open, top-level checklists. */
  openInstances: { id: string; template_id: string | null }[];
  now?: Date;
}): AssetTriggerPlan {
  const plan: AssetTriggerPlan = { add: [], create: [] };
  if (!input.holderUserId) return plan;
  const now = input.now ?? new Date();

  for (const template of input.templates) {
    const sections = template.sections.filter((s) => watches(s, input.assetId, input.event));
    if (sections.length === 0) continue;
    const open = input.openInstances.filter((i) => i.template_id === template.id);
    if (open.length > 0) {
      for (const instance of open) {
        for (const section of sections) plan.add.push({ instanceId: instance.id, section });
      }
    } else if (template.trigger_type === "asset" && eligibleToday(template, now)) {
      plan.create.push({
        template,
        instanceId: assetTriggerInstanceId(input.checkoutId, input.event, template.id),
        sections,
      });
    }
  }
  return plan;
}
