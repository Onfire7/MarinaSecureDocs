import { useQuery } from "@powersync/react";
import { id as newId, stamp } from "../lib/db";
import type { LockContext } from "@powersync/web";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";
import { unexpectedOccupancy } from "../lib/audits";
import type { AnswerValue, AmenityAnswer, AttributeAnswer, ServiceAnswer, WizardItem } from "../lib/auditWizard";

// The wizard's writes (docs/audits.md § The wizard). One item at a time,
// the moment it is answered.
//
// This is deliberately NOT saveFinding(). That function rewrites a
// Finding's parts wholesale - it deletes every service, amenity, answer and
// undecided proposal and re-inserts what the form holds - which is right
// for a form showing everything and fatal for a wizard showing a slice: a
// run that asks only about Power would erase the amenities an earlier run
// recorded. Everything here merges instead. It touches the one item it was
// given and leaves the rest of the Finding exactly as it found it.
//
// What applies at once and what waits for approval is unchanged
// (docs/audits.md § What applies immediately): a Service's working flag and
// note apply now, its presence is a Proposal, and every Attribute value is
// a Proposal. Re-answering replaces that Proposal rather than adding a
// second one, and answering back to what is on file removes it.

export interface WizardWrite {
  auditId: string;
  auditKind: "occupancy" | "status";
  targetId: string;
  locationId: string | null;
  locationName: string;
  item: Pick<WizardItem, "key" | "kind" | "entryId">;
  value: AnswerValue;
  actorId: string;
  /** Occupancy only: what the lease and reservations on file say. */
  expected?: { hasCurrentLease: boolean; hasActiveReservation: boolean };
}

/** Write one answer. Returns the Finding's id, creating it on first touch. */
export function recordWizardItem(w: WizardWrite): Promise<string> {
  return transact(async (tx) => {
    const findingId = await ensureFinding(tx, w);
    switch (w.item.kind) {
      case "service":
        await writeService(tx, w, findingId);
        break;
      case "amenity":
        await writeAmenity(tx, w, findingId);
        break;
      case "attribute":
        await writeAttribute(tx, w, findingId);
        break;
      case "question":
        await writeAnswer(tx, w, findingId);
        break;
      case "status":
        if (w.locationId && typeof w.value === "string" && w.value)
          await update(tx, "locations", w.locationId, { status_id: w.value });
        break;
      case "marked":
        await update(tx, "audit_findings", findingId, { clearly_marked: boolValue(w.value), updated_at: stamp() });
        break;
      case "map":
        await update(tx, "audit_findings", findingId, { mapped_correctly: boolValue(w.value), updated_at: stamp() });
        break;
      case "occupied":
        await writeOccupied(tx, w, findingId);
        break;
      case "gps":
        await writeGps(tx, w, findingId);
        break;
    }
    return findingId;
  });
}

/** The Finding a run writes into: one per target, made on the first answer.
 *  Creating it is what marks the Location audited (a database trigger does
 *  that), which is why a run that answers one item still counts - the pills
 *  on the audit page are what say the rest is unanswered. */
async function ensureFinding(tx: LockContext, w: WizardWrite): Promise<string> {
  const row = await tx.getOptional<{ id: string }>("SELECT id FROM audit_findings WHERE target_id = ?", [w.targetId]);
  if (row) return row.id;
  const findingId = await insert(tx, "audit_findings", {
    audit_id: w.auditId,
    target_id: w.targetId,
    recorded_by_id: w.actorId,
    recorded_at: stamp(),
    updated_at: stamp(),
    unexpected_occupancy: 0,
    is_current: 1,
  });
  if (w.locationId) {
    await recordActivity(tx, {
      eventType: "location.audited",
      summary: `${w.locationName} audited`,
      subjectType: "locations",
      subjectId: w.locationId,
      actorId: w.actorId,
    });
  }
  return findingId;
}

async function writeService(tx: LockContext, w: WizardWrite, findingId: string) {
  const v = w.value as ServiceAnswer;
  const serviceId = w.item.entryId!;
  const present = v.present === true;
  const existing = await tx.getOptional<{ id: string }>(
    "SELECT id FROM audit_finding_services WHERE finding_id = ? AND service_id = ?",
    [findingId, serviceId],
  );
  const row = { present: present ? 1 : 0, working: v.working ? 1 : 0, note: v.note || null };
  if (existing) await update(tx, "audit_finding_services", existing.id, row);
  else await insert(tx, "audit_finding_services", { finding_id: findingId, service_id: serviceId, is_current: 1, ...row });
  if (!w.locationId) return;

  const onFile = await tx.getOptional<{ id: string; working: number; note: string | null }>(
    "SELECT id, working, note FROM location_services WHERE location_id = ? AND service_id = ?",
    [w.locationId, serviceId],
  );
  if (present !== !!onFile) {
    // Presence waits for approval.
    await replaceProposal(tx, findingId, "set_service", serviceId, { service_id: serviceId, present });
  } else {
    await replaceProposal(tx, findingId, "set_service", serviceId, null);
    // Working and the note apply now, to the row that is already there.
    if (onFile && (onFile.working === 1) !== v.working) await update(tx, "location_services", onFile.id, { working: v.working ? 1 : 0 });
    if (onFile && (onFile.note ?? null) !== (v.note || null)) await update(tx, "location_services", onFile.id, { note: v.note || null });
  }
}

async function writeAmenity(tx: LockContext, w: WizardWrite, findingId: string) {
  const v = w.value as AmenityAnswer;
  const amenityId = w.item.entryId!;
  const present = v.present === true;
  const existing = await tx.getOptional<{ id: string }>(
    "SELECT id FROM audit_finding_amenities WHERE finding_id = ? AND amenity_id = ?",
    [findingId, amenityId],
  );
  const row = { present: present ? 1 : 0, note: v.note || null };
  if (existing) await update(tx, "audit_finding_amenities", existing.id, row);
  else await insert(tx, "audit_finding_amenities", { finding_id: findingId, amenity_id: amenityId, is_current: 1, ...row });
  if (!w.locationId) return;

  const onFile = await tx.getOptional<{ id: string; note: string | null }>(
    "SELECT id, note FROM location_amenities WHERE location_id = ? AND amenity_id = ?",
    [w.locationId, amenityId],
  );
  if (present !== !!onFile) {
    await replaceProposal(tx, findingId, "set_amenity", amenityId, { amenity_id: amenityId, present });
  } else {
    await replaceProposal(tx, findingId, "set_amenity", amenityId, null);
    if (onFile && (onFile.note ?? null) !== (v.note || null)) await update(tx, "location_amenities", onFile.id, { note: v.note || null });
  }
}

/** Every Attribute change is a Proposal, including clearing one - and
 *  answering back to what is on file withdraws the Proposal rather than
 *  proposing a no-op. */
async function writeAttribute(tx: LockContext, w: WizardWrite, findingId: string) {
  const v = w.value as AttributeAnswer;
  const attributeId = w.item.entryId!;
  if (!w.locationId) return;
  const onFile = await tx.getOptional<{ value: number | null; value_text: string | null; note: string | null }>(
    "SELECT value, value_text, note FROM location_attributes WHERE location_id = ? AND attribute_id = ?",
    [w.locationId, attributeId],
  );
  const value = v.value.trim() === "" ? null : Number(v.value);
  const text = v.text.trim() === "" ? null : v.text;
  const note = v.note.trim() === "" ? null : v.note;
  const same = (onFile?.value ?? null) === value && (onFile?.value_text ?? null) === text && (onFile?.note ?? null) === note;
  await replaceProposal(
    tx,
    findingId,
    "set_attribute",
    attributeId,
    same ? null : { attribute_id: attributeId, value, text, note },
  );
}

async function writeAnswer(tx: LockContext, w: WizardWrite, findingId: string) {
  const questionId = w.item.entryId!;
  const existing = await tx.getOptional<{ id: string }>(
    "SELECT id FROM audit_finding_answers WHERE finding_id = ? AND question_id = ?",
    [findingId, questionId],
  );
  const value = JSON.stringify(w.value ?? null);
  if (existing) await update(tx, "audit_finding_answers", existing.id, { value });
  else await insert(tx, "audit_finding_answers", { finding_id: findingId, question_id: questionId, value, is_current: 1 });
}

async function writeOccupied(tx: LockContext, w: WizardWrite, findingId: string) {
  const occupied = boolValue(w.value);
  const unexpected =
    w.auditKind === "occupancy" && occupied !== null && w.expected
      ? unexpectedOccupancy({ occupied: occupied === 1, ...w.expected })
      : false;
  await update(tx, "audit_findings", findingId, {
    occupied,
    unexpected_occupancy: unexpected ? 1 : 0,
    updated_at: stamp(),
  });
}

async function writeGps(tx: LockContext, w: WizardWrite, findingId: string) {
  const fix = w.value as { lat: number; lng: number; accuracy: number } | null;
  await replaceProposal(tx, findingId, "set_gps", null, fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null);
}

/**
 * One undecided Proposal per kind per entry per Finding. Re-answering an
 * item replaces its Proposal; answering back to what is on file removes it.
 * A Proposal that has already been decided is never touched - the finalizer
 * has spoken.
 */
async function replaceProposal(
  tx: LockContext,
  findingId: string,
  kind: "set_service" | "amenity" | "set_amenity" | "set_attribute" | "set_gps",
  entryId: string | null,
  payload: Record<string, unknown> | null,
) {
  const column = kind === "set_service" ? "service_id" : kind === "set_amenity" ? "amenity_id" : "attribute_id";
  const existing = await tx.getAll<{ id: string }>(
    `SELECT id FROM audit_proposals
      WHERE finding_id = ? AND kind = ? AND decision IS NULL
        ${entryId ? `AND json_extract(payload, '$.${column}') = ?` : ""}`,
    entryId ? [findingId, kind, entryId] : [findingId, kind],
  );
  for (const row of existing) await remove(tx, "audit_proposals", row.id);
  if (payload) {
    await insert(tx, "audit_proposals", {
      finding_id: findingId,
      kind,
      structural: 0, // set by a trigger from the kind
      payload: JSON.stringify(payload),
      is_current: 1,
    });
  }
}

function boolValue(v: AnswerValue): number | null {
  return typeof v === "boolean" ? (v ? 1 : 0) : null;
}

// ── what a run reads ─────────────────────────────────────────────────────

/** Which questions the Rules attached to which target, for the whole audit.
 *  Joined on `id`, never on a foreign key (CLAUDE.md). */
export function useAuditTargetQuestions(auditId: string | undefined) {
  return useQuery<{ target_id: string; question_id: string }>(
    `SELECT tq.target_id, tq.question_id
       FROM audit_target_questions tq
       JOIN audit_targets t ON t.id = tq.target_id
      WHERE t.audit_id = ?`,
    [auditId ?? ""],
  );
}

/** Which targets already have a Finding: the run dims them, and the
 *  "still to do" filter drops them. */
export function useAuditFindingTargets(auditId: string | undefined) {
  return useQuery<{ target_id: string }>(
    "SELECT target_id FROM audit_findings WHERE audit_id = ? AND target_id IS NOT NULL",
    [auditId ?? ""],
  );
}

/** Everything a wizard run has already recorded for a target, so reopening
 *  one shows what is there rather than starting blank. */
export function useFindingForTarget(targetId: string | undefined) {
  return useQuery<{
    finding_id: string;
    clearly_marked: number | null;
    mapped_correctly: number | null;
    occupied: number | null;
  }>(
    `SELECT id AS finding_id, clearly_marked, mapped_correctly, occupied
       FROM audit_findings WHERE target_id = ?`,
    [targetId ?? ""],
  );
}

/** The id a new Finding would take, so a caller can raise a Ticket against
 *  an answer in the same breath. */
export function provisionalFindingId(): string {
  return newId();
}
