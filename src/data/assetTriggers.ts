import type { LockContext } from "@powersync/web";
import { dataT } from "../i18n";
import { assetTriggerInstanceId, planAssetTrigger, watches } from "../lib/assetTriggers";
import type { AssetEvent, InstantiableTemplate } from "../lib/checklists";
import { recordActivity } from "./activity";
import { loadInstantiableTemplate } from "./checklists";
import { insertInstance, insertSectionInstance, sectionInstanceId } from "./checklistInstantiation";
import { remove } from "./sql";

// Asset triggers (src/pages/admin/AdminChecklistTemplatesPage.spec.md
// § Asset triggers): the checklist work an Asset's check-out or check-in
// creates, written inside the transaction that checks it out or in, so a
// checkout is never recorded without its work. The decision is
// src/lib/assetTriggers.ts; this reads its inputs and writes its plan.

export interface AssetTriggerEvent {
  event: AssetEvent;
  asset: { id: string; name: string };
  checkoutId: string;
  /** The checkout's person: a Contact. The work goes to their user. */
  personContactId: string | null;
  /** When the event happened, as stamped on the checkout. */
  at: string;
}

/** The active marina user linked to a Contact: who holds the asset. */
async function holderOf(tx: LockContext, contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const row = await tx.getOptional<{ id: string }>(
    "SELECT id FROM users WHERE contact_id = ? AND active = 1 ORDER BY name LIMIT 1",
    [contactId],
  );
  return row?.id ?? null;
}

/** Templates with an active section watching this asset. Correlated, not joined: see CLAUDE.md. */
async function watchingTemplates(tx: LockContext, assetId: string): Promise<InstantiableTemplate[]> {
  const ids = await tx.getAll<{ template_id: string }>(
    `SELECT DISTINCT s.template_id FROM checklist_template_sections s
      WHERE s.is_active = 1 AND s.trigger_type = 'asset'
        AND EXISTS (SELECT 1 FROM template_section_assets sa
                     WHERE sa.section_id = s.id AND sa.asset_id = ?)`,
    [assetId],
  );
  const templates: InstantiableTemplate[] = [];
  for (const { template_id } of ids) {
    const template = await loadInstantiableTemplate(tx, template_id);
    if (template) templates.push(template);
  }
  return templates;
}

function openInstancesOf(tx: LockContext, userId: string) {
  return tx.getAll<{ id: string; template_id: string | null }>(
    `SELECT id, template_id FROM checklist_instances
      WHERE assigned_to_id = ? AND parent_item_id IS NULL AND status <> 'complete'`,
    [userId],
  );
}

export async function fireAssetTrigger(
  tx: LockContext,
  e: AssetTriggerEvent,
  actorId: string | null,
): Promise<void> {
  const holder = await holderOf(tx, e.personContactId);
  if (!holder) return;
  const templates = await watchingTemplates(tx, e.asset.id);
  if (templates.length === 0) return;
  const now = new Date(e.at);
  const plan = planAssetTrigger({
    event: e.event,
    assetId: e.asset.id,
    checkoutId: e.checkoutId,
    holderUserId: holder,
    templates,
    openInstances: await openInstancesOf(tx, holder),
    now,
  });

  for (const { instanceId, section } of plan.add) {
    await insertSectionInstance(tx, instanceId, section, now);
  }
  for (const { template, instanceId, sections } of plan.create) {
    // The holder's, whatever the template says about assignment: the work is
    // about the vehicle in their hands.
    await insertInstance(tx, { template: { ...template, assigned_to_user: 1 }, instanceId, userId: holder, now });
    for (const section of sections) await insertSectionInstance(tx, instanceId, section, now);
    await recordActivity(tx, {
      eventType: "checklist.created",
      summary: dataT(
        e.event === "check_out" ? "fleetActivity.createdByCheckOut" : "fleetActivity.createdByCheckIn",
        { ns: "home", template: template.name, vehicle: e.asset.name },
      ),
      subjectType: "checklist_instances",
      subjectId: instanceId,
      actorId,
    });
  }
}

/** True when nothing on these instance items has been answered. */
async function untouched(tx: LockContext, sectionIds: string[]): Promise<boolean> {
  if (sectionIds.length === 0) return true;
  const row = await tx.getOptional<{ n: number }>(
    `SELECT count(*) AS n FROM checklist_instance_items
      WHERE section_id IN (${sectionIds.map(() => "?").join(", ")})
        AND (completed_at IS NOT NULL OR result IS NOT NULL OR note IS NOT NULL)`,
    sectionIds,
  );
  return (row?.n ?? 0) === 0;
}

async function removeSection(tx: LockContext, sectionId: string): Promise<void> {
  await tx.execute("DELETE FROM checklist_instance_items WHERE section_id = ?", [sectionId]);
  await remove(tx, "checklist_instance_sections", sectionId);
}

/**
 * Take back the work an event created, where none of it has been answered:
 * the checklist it created, and the sections it added to open ones. A section
 * that was already there before the event (added by an earlier checkout) is
 * not this event's, and stays.
 */
export async function undoAssetTrigger(tx: LockContext, e: AssetTriggerEvent): Promise<void> {
  const holder = await holderOf(tx, e.personContactId);
  if (!holder) return;
  const templates = await watchingTemplates(tx, e.asset.id);
  const open = await openInstancesOf(tx, holder);
  const since = Date.parse(e.at) - 1000;

  for (const template of templates) {
    const created = assetTriggerInstanceId(e.checkoutId, e.event, template.id);
    const createdSections = await tx.getAll<{ id: string }>(
      "SELECT id FROM checklist_instance_sections WHERE instance_id = ?",
      [created],
    );
    if (createdSections.length > 0 && (await untouched(tx, createdSections.map((s) => s.id)))) {
      for (const s of createdSections) await removeSection(tx, s.id);
      await remove(tx, "checklist_instances", created);
    }

    const sections = template.sections.filter((s) => watches(s, e.asset.id, e.event));
    for (const instance of open.filter((i) => i.template_id === template.id && i.id !== created)) {
      for (const section of sections) {
        const sid = sectionInstanceId(instance.id, section.id);
        const row = await tx.getOptional<{ created_at: string | null }>(
          "SELECT created_at FROM checklist_instance_sections WHERE id = ?",
          [sid],
        );
        if (!row?.created_at || Date.parse(row.created_at) < since) continue;
        if (await untouched(tx, [sid])) await removeSection(tx, sid);
      }
    }
  }
}
