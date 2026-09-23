import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import { db, id as newId, stamp } from "../lib/db";
import { supabase } from "../lib/db/supabase";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";
import { attributeDiff, servicePresenceDiff, unexpectedOccupancy, type ObservedAttribute, type ObservedService } from "../lib/audits";
import {
  resolveTargets,
  type AuditKind,
  type Condition,
  type RuleLocation,
  type RuleNode,
  type Target,
} from "../lib/auditRules";
import { useLocations, useLocationTypes } from "./locations";
import { useLocationStatuses } from "./lookups";
import { useAllLocationAmenities, useAllLocationServices } from "./services";

// Audits — docs/audits.md. Templates and their rule trees; launching, which
// resolves the tree into a fixed target list; findings and what they apply
// at once; proposals and their decisions. Closing and finalizing are RPCs:
// they are desk operations that change marina structure, and the database
// holds the checks (docs/data-model.md § Audits).

// ── rows ─────────────────────────────────────────────────────────────────

// Which built-in Status-kind sections a Template or Audit asks about.
// Occupancy's built-ins ("Occupied?" plus occupants) are not split into
// categories — they're what makes it an Occupancy audit — so these only
// mean anything for kind "status". Copied from Template onto Audit at
// launch, like the rule tree and kind.
export interface AuditCategoryFlags {
  include_attributes: number;
  include_services: number;
  include_amenities: number;
  include_marked: number;
  include_map: number;
}
export const DEFAULT_CATEGORY_FLAGS: AuditCategoryFlags = {
  include_attributes: 1,
  include_services: 1,
  include_amenities: 1,
  include_marked: 1,
  include_map: 1,
};

export interface AuditTemplateRow extends AuditCategoryFlags {
  id: string;
  name: string;
  kind: AuditKind;
  created_by_id: string | null;
  created_at: string;
}
export interface AuditRuleRow {
  id: string;
  template_id: string | null;
  audit_id: string | null;
  parent_rule_id: string | null;
  position: number;
  mode: "all" | "any";
  conditions: string | null;
}
export type QuestionKind = "yes_no" | "choice" | "text" | "meter_reading";
export interface AuditQuestionRow {
  id: string;
  rule_id: string;
  position: number;
  prompt: string;
  kind: QuestionKind;
  choices: string | null;
  ticket_on_no: number;
  service_id: string | null;
}
export type AuditStatus = "open" | "closed" | "finalized";
export interface AuditRow extends AuditCategoryFlags {
  id: string;
  name: string;
  kind: AuditKind;
  template_id: string | null;
  status: AuditStatus;
  launched_by_id: string | null;
  launched_at: string;
  closed_by_id: string | null;
  closed_at: string | null;
  finalized_by_id: string | null;
  finalized_at: string | null;
  target_count: number;
  audited_count: number;
  not_audited_count: number;
  undecided_count: number;
}
export interface AuditAssigneeRow {
  id: string;
  audit_id: string;
  user_id: string | null;
  role_id: string | null;
}
export type TargetState = "pending" | "audited" | "not_audited";
export interface AuditTargetRow {
  id: string;
  audit_id: string;
  location_id: string | null;
  location_name: string;
  position: number;
  state: TargetState;
  not_audited_reason: string | null;
  displaced_note: string | null;
  /** Joined from the location, when it still exists. */
  parent_id: string | null;
  location_type_id: string | null;
  type_name: string | null;
  status_id: string | null;
  status_name: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  has_boat: number;
  has_vehicle: number;
  finding_id: string | null;
}
export interface AuditFindingRow {
  id: string;
  audit_id: string;
  target_id: string | null;
  recorded_by_id: string;
  recorded_at: string;
  updated_at: string;
  occupied: number | null;
  contact_id: string | null;
  unexpected_occupancy: number;
  clearly_marked: number | null;
  mapped_correctly: number | null;
}
export type ProposalKind =
  | "create_location"
  | "retire_location"
  | "rename"
  | "retype"
  | "reparent"
  | "move_placement"
  | "set_gps"
  | "set_service"
  | "set_amenity"
  | "set_attribute";
export interface AuditProposalRow {
  id: string;
  finding_id: string;
  kind: ProposalKind;
  structural: number;
  payload: string;
  decision: "approved" | "rejected" | null;
  decided_by_id: string | null;
  decided_at: string | null;
  reason: string | null;
  applied_location_id: string | null;
  /** Joined. */
  target_location_id: string | null;
  location_name: string | null;
  recorded_by_name: string | null;
}

// ── the draft tree the editors work on ───────────────────────────────────

export interface DraftQuestion {
  id: string;
  prompt: string;
  kind: QuestionKind;
  choices: string[];
  ticketOnNo: boolean;
  serviceId: string | null;
}
export interface DraftRule {
  id: string;
  mode: "all" | "any";
  conditions: Condition[];
  questions: DraftQuestion[];
  children: DraftRule[];
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Rows → tree. Rules whose parent is missing are treated as roots. */
export function rowsToDraft(rules: AuditRuleRow[], questions: AuditQuestionRow[]): DraftRule[] {
  const byId = new Map<string, DraftRule>();
  for (const r of rules) {
    byId.set(r.id, {
      id: r.id,
      mode: r.mode,
      conditions: parseJson<Condition[]>(r.conditions, []),
      questions: [],
      children: [],
    });
  }
  for (const q of [...questions].sort((a, b) => a.position - b.position)) {
    byId.get(q.rule_id)?.questions.push({
      id: q.id,
      prompt: q.prompt,
      kind: q.kind,
      choices: parseJson<string[]>(q.choices, []),
      ticketOnNo: q.ticket_on_no === 1,
      serviceId: q.service_id,
    });
  }
  const roots: DraftRule[] = [];
  for (const r of [...rules].sort((a, b) => a.position - b.position)) {
    const node = byId.get(r.id)!;
    const parent = r.parent_rule_id ? byId.get(r.parent_rule_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function draftToNodes(draft: DraftRule[]): RuleNode[] {
  return draft.map((d) => ({
    id: d.id,
    mode: d.mode,
    conditions: d.conditions,
    questionIds: d.questions.map((q) => q.id),
    children: draftToNodes(d.children),
  }));
}

export function newDraftRule(conditions: Condition[] = []): DraftRule {
  return { id: newId(), mode: "all", conditions, questions: [], children: [] };
}
export function newDraftQuestion(prompt: string): DraftQuestion {
  return { id: newId(), prompt, kind: "yes_no", choices: [], ticketOnNo: false, serviceId: null };
}

export function updateDraftRule(roots: DraftRule[], id: string, fn: (r: DraftRule) => DraftRule): DraftRule[] {
  return roots.map((r) => (r.id === id ? fn(r) : { ...r, children: updateDraftRule(r.children, id, fn) }));
}
export function removeDraftRule(roots: DraftRule[], id: string): DraftRule[] {
  return roots.filter((r) => r.id !== id).map((r) => ({ ...r, children: removeDraftRule(r.children, id) }));
}
export function findDraftRule(roots: DraftRule[], id: string): DraftRule | undefined {
  for (const r of roots) {
    if (r.id === id) return r;
    const c = findDraftRule(r.children, id);
    if (c) return c;
  }
  return undefined;
}
export function pathToDraftRule(roots: DraftRule[], id: string): DraftRule[] {
  for (const r of roots) {
    if (r.id === id) return [r];
    const c = pathToDraftRule(r.children, id);
    if (c.length) return [r, ...c];
  }
  return [];
}
export function allDraftQuestions(roots: DraftRule[]): DraftQuestion[] {
  const out: DraftQuestion[] = [];
  const walk = (r: DraftRule) => {
    out.push(...r.questions);
    r.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

// ── templates ────────────────────────────────────────────────────────────

export function useAuditTemplates() {
  return useQuery<AuditTemplateRow>("SELECT * FROM audit_templates ORDER BY name");
}
export function useAuditTemplate(templateId: string | undefined) {
  const { data, isLoading } = useQuery<AuditTemplateRow>("SELECT * FROM audit_templates WHERE id = ?", [
    templateId ?? "",
  ]);
  return { template: data[0] ?? null, isLoading };
}
export function useTemplateRules(templateId: string | undefined) {
  return useQuery<AuditRuleRow>("SELECT * FROM audit_rules WHERE template_id = ? ORDER BY position", [
    templateId ?? "",
  ]);
}
export function useTemplateQuestions(templateId: string | undefined) {
  return useQuery<AuditQuestionRow>(
    `SELECT q.* FROM audit_questions q JOIN audit_rules r ON r.id = q.rule_id
      WHERE r.template_id = ? ORDER BY q.position`,
    [templateId ?? ""],
  );
}
export function useAuditRules(auditId: string | undefined) {
  return useQuery<AuditRuleRow>("SELECT * FROM audit_rules WHERE audit_id = ? ORDER BY position", [
    auditId ?? "",
  ]);
}
export function useAuditQuestions(auditId: string | undefined) {
  return useQuery<AuditQuestionRow>(
    `SELECT q.* FROM audit_questions q JOIN audit_rules r ON r.id = q.rule_id
      WHERE r.audit_id = ? ORDER BY q.position`,
    [auditId ?? ""],
  );
}

export function createAuditTemplate(
  input: { name: string; kind: AuditKind },
  actorId: string | null,
): Promise<string> {
  return insert(db, "audit_templates", {
    name: input.name,
    kind: input.kind,
    created_by_id: actorId,
    created_at: stamp(),
    // Explicit, not relied on as a Postgres default: PowerSync's local row
    // is a JSON blob keyed by what was actually written. A column never
    // set locally reads back as NULL when a later PATCH uploads the row,
    // which a `not null` column then refuses — the checkbox toggle a user
    // makes right after creating a template would be silently discarded.
    ...DEFAULT_CATEGORY_FLAGS,
  });
}
export function saveAuditTemplate(
  templateId: string,
  input: { name?: string } & Partial<AuditCategoryFlags>,
): Promise<void> {
  return update(db, "audit_templates", templateId, {
    name: input.name,
    include_attributes: input.include_attributes,
    include_services: input.include_services,
    include_amenities: input.include_amenities,
    include_marked: input.include_marked,
    include_map: input.include_map,
  });
}
export function deleteAuditTemplate(templateId: string): Promise<void> {
  return remove(db, "audit_templates", templateId);
}

type Owner = { template_id: string; audit_id: null } | { template_id: null; audit_id: string };

/** Write a draft tree as rows under an owner, keeping the draft's ids. */
async function insertTree(
  tx: Parameters<Parameters<typeof transact>[0]>[0],
  owner: Owner,
  roots: DraftRule[],
  idMap?: Map<string, string>,
): Promise<void> {
  const walk = async (rule: DraftRule, parentId: string | null, position: number) => {
    const ruleId = idMap ? newId() : rule.id;
    if (idMap) idMap.set(rule.id, ruleId);
    await insert(tx, "audit_rules", {
      id: ruleId,
      ...owner,
      parent_rule_id: parentId,
      position,
      mode: rule.mode,
      conditions: JSON.stringify(rule.conditions),
    });
    for (const [i, q] of rule.questions.entries()) {
      const qId = idMap ? newId() : q.id;
      if (idMap) idMap.set(q.id, qId);
      await insert(tx, "audit_questions", {
        id: qId,
        rule_id: ruleId,
        position: i,
        prompt: q.prompt,
        kind: q.kind,
        choices: JSON.stringify(q.choices),
        ticket_on_no: q.ticketOnNo ? 1 : 0,
        service_id: q.serviceId,
      });
    }
    for (const [i, c] of rule.children.entries()) await walk(c, ruleId, i);
  };
  for (const [i, r] of roots.entries()) await walk(r, null, i);
}

/** Replace a template's whole tree. Small enough that delete-and-rewrite beats a diff. */
export function saveTemplateTree(templateId: string, roots: DraftRule[]): Promise<void> {
  return transact(async (tx) => {
    await tx.execute(
      "DELETE FROM audit_questions WHERE rule_id IN (SELECT id FROM audit_rules WHERE template_id = ?)",
      [templateId],
    );
    await tx.execute("DELETE FROM audit_rules WHERE template_id = ?", [templateId]);
    await insertTree(tx, { template_id: templateId, audit_id: null }, roots);
  });
}

// ── what the rules see ───────────────────────────────────────────────────

/**
 * Every location as the evaluator wants it. Built from always-resident
 * tables plus the occupancy stream, so a launch works on a dock.
 */
export function useRuleLocations(): RuleLocation[] {
  const { data: locations } = useLocations();
  const { data: types } = useLocationTypes();
  const { statuses } = useLocationStatuses();
  const { data: ls } = useAllLocationServices();
  const { data: la } = useAllLocationAmenities();
  const { data: leased } = useQuery<{ location_id: string }>(
    `SELECT DISTINCT location_id FROM leases
      WHERE is_current = 1
        AND (start_date IS NULL OR start_date <= ?1)
        AND (end_date IS NULL OR end_date >= ?1)`,
    [stamp()],
  );
  const { data: reserved } = useQuery<{ location_id: string }>(
    "SELECT DISTINCT location_id FROM reservations WHERE status = 'checked_in' AND location_id IS NOT NULL",
  );
  return useMemo(() => {
    const typeById = new Map(types.map((t) => [t.id, t]));
    const vacancy = new Set(statuses.filter((s) => s.is_vacancy).map((s) => s.name));
    const services = new Map<string, string[]>();
    for (const r of ls) services.set(r.location_id, [...(services.get(r.location_id) ?? []), r.service_id]);
    const amenities = new Map<string, string[]>();
    for (const r of la) amenities.set(r.location_id, [...(amenities.get(r.location_id) ?? []), r.amenity_id]);
    const leasedSet = new Set(leased.map((r) => r.location_id));
    const reservedSet = new Set(reserved.map((r) => r.location_id));
    return locations.map((l) => ({
      id: l.id,
      name: l.name,
      typeName: typeById.get(l.location_type_id)?.name ?? l.type_name,
      parentId: l.parent_id,
      statusName: l.status_name,
      isVacancy: l.status_name !== null && vacancy.has(l.status_name),
      tracksStatus: l.tracks_status === 1,
      retired: l.retired_at !== null,
      serviceIds: services.get(l.id) ?? [],
      amenityIds: amenities.get(l.id) ?? [],
      hasCurrentLease: leasedSet.has(l.id),
      hasActiveReservation: reservedSet.has(l.id),
      lastAudited: { occupancy: l.last_occupancy_audit_at, status: l.last_status_audit_at },
    }));
  }, [locations, types, statuses, ls, la, leased, reserved]);
}

// ── launching ────────────────────────────────────────────────────────────

export interface LaunchInput extends AuditCategoryFlags {
  name: string;
  kind: AuditKind;
  templateId: string | null;
  roots: DraftRule[];
  targets: Target[];
  userIds: string[];
  roleIds: string[];
}

/**
 * Launch: copy the (possibly edited) tree onto the audit with fresh ids,
 * write the fixed target list and each target's questions, assign.
 */
export async function launchAudit(input: LaunchInput, actorId: string | null): Promise<string> {
  const locations = await db.getAll<{ id: string; name: string }>(
    "SELECT id, name FROM locations WHERE retired_at IS NULL",
  );
  const nameOf = new Map(locations.map((l) => [l.id, l.name]));
  return transact(async (tx) => {
    const auditId = await insert(tx, "audits", {
      name: input.name,
      kind: input.kind,
      template_id: input.templateId,
      status: "open",
      launched_by_id: actorId,
      launched_at: stamp(),
      is_current: 1,
      include_attributes: input.include_attributes,
      include_services: input.include_services,
      include_amenities: input.include_amenities,
      include_marked: input.include_marked,
      include_map: input.include_map,
    });
    const idMap = new Map<string, string>();
    await insertTree(tx, { template_id: null, audit_id: auditId }, input.roots, idMap);
    for (const userId of input.userIds) {
      await insert(tx, "audit_assignees", { audit_id: auditId, user_id: userId, role_id: null, is_current: 1 });
    }
    for (const roleId of input.roleIds) {
      await insert(tx, "audit_assignees", { audit_id: auditId, user_id: null, role_id: roleId, is_current: 1 });
    }
    for (const [i, t] of input.targets.entries()) {
      const targetId = await insert(tx, "audit_targets", {
        audit_id: auditId,
        location_id: t.locationId,
        location_name: nameOf.get(t.locationId) ?? "?",
        position: i,
        state: "pending",
        is_current: 1,
      });
      for (const [j, q] of t.questionIds.entries()) {
        await insert(tx, "audit_target_questions", {
          target_id: targetId,
          question_id: idMap.get(q) ?? q,
          position: j,
          is_current: 1,
        });
      }
    }
    await recordActivity(tx, {
      eventType: "audit.launched",
      summary: `Audit "${input.name}" launched over ${input.targets.length} locations`,
      subjectType: "audits",
      subjectId: auditId,
      actorId,
    });
    return auditId;
  });
}

/** Resolve a draft against the marina, for the launch preview and the launch itself. */
export function resolveDraft(roots: DraftRule[], locations: RuleLocation[], kind: AuditKind) {
  return resolveTargets(draftToNodes(roots), locations, { kind });
}

// ── audits ───────────────────────────────────────────────────────────────

const AUDIT_SELECT = `
  SELECT a.*,
         (SELECT COUNT(*) FROM audit_targets t WHERE t.audit_id = a.id) AS target_count,
         (SELECT COUNT(*) FROM audit_targets t WHERE t.audit_id = a.id AND t.state = 'audited') AS audited_count,
         (SELECT COUNT(*) FROM audit_targets t WHERE t.audit_id = a.id AND t.state = 'not_audited') AS not_audited_count,
         (SELECT COUNT(*) FROM audit_proposals p JOIN audit_findings f ON f.id = p.finding_id
           WHERE f.audit_id = a.id AND p.decision IS NULL) AS undecided_count
    FROM audits a`;

export function useAudits() {
  return useQuery<AuditRow>(`${AUDIT_SELECT} ORDER BY a.launched_at DESC`);
}
export function useAudit(auditId: string | undefined) {
  const { data, isLoading } = useQuery<AuditRow>(`${AUDIT_SELECT} WHERE a.id = ?`, [auditId ?? ""]);
  return { audit: data[0] ?? null, isLoading };
}
export function useAuditAssignees(auditId: string | undefined) {
  return useQuery<AuditAssigneeRow>("SELECT * FROM audit_assignees WHERE audit_id = ?", [auditId ?? ""]);
}

const TARGET_SELECT = `
  SELECT t.*,
         l.parent_id, l.location_type_id, l.status_id, l.gps_lat, l.gps_lng,
         ty.name AS type_name, ty.has_boat, ty.has_vehicle,
         s.name AS status_name,
         (SELECT f.id FROM audit_findings f WHERE f.target_id = t.id) AS finding_id
    FROM audit_targets t
    LEFT JOIN locations l ON l.id = t.location_id
    LEFT JOIN location_types ty ON ty.id = l.location_type_id
    LEFT JOIN location_statuses s ON s.id = l.status_id`;

export function useAuditTargets(auditId: string | undefined) {
  return useQuery<AuditTargetRow>(`${TARGET_SELECT} WHERE t.audit_id = ? ORDER BY t.position`, [
    auditId ?? "",
  ]);
}
export function useAuditTarget(targetId: string | undefined) {
  const { data, isLoading } = useQuery<AuditTargetRow>(`${TARGET_SELECT} WHERE t.id = ?`, [targetId ?? ""]);
  return { target: data[0] ?? null, isLoading };
}
export function useTargetQuestions(targetId: string | undefined) {
  return useQuery<AuditQuestionRow>(
    `SELECT q.* FROM audit_target_questions tq JOIN audit_questions q ON q.id = tq.question_id
      WHERE tq.target_id = ? ORDER BY tq.position`,
    [targetId ?? ""],
  );
}

export interface MyTargetRow extends AuditTargetRow {
  audit_name: string;
  audit_kind: AuditKind;
}

/**
 * Pending targets of open audits assigned to this user or one of their
 * roles. The section on top of a checklist filters these to a subtree.
 */
export function useMyPendingTargets(userId: string | undefined, roleIds: string[], includeAll = false) {
  const roleList = roleIds.length ? roleIds.map(() => "?").join(",") : "''";
  return useQuery<MyTargetRow>(
    `SELECT t.*, l.parent_id, l.location_type_id, l.status_id, l.gps_lat, l.gps_lng,
            ty.name AS type_name, ty.has_boat, ty.has_vehicle, s.name AS status_name,
            NULL AS finding_id, a.name AS audit_name, a.kind AS audit_kind
       FROM audit_targets t
       JOIN audits a ON a.id = t.audit_id
       LEFT JOIN locations l ON l.id = t.location_id
       LEFT JOIN location_types ty ON ty.id = l.location_type_id
       LEFT JOIN location_statuses s ON s.id = l.status_id
      WHERE a.status = 'open' AND t.state = 'pending'
        AND (?1 = 1 OR EXISTS (SELECT 1 FROM audit_assignees x WHERE x.audit_id = a.id
                                  AND (x.user_id = ?2 OR x.role_id IN (${roleList}))))
      ORDER BY a.launched_at, t.position`,
    [includeAll ? 1 : 0, userId ?? "", ...roleIds],
  );
}

// ── findings ─────────────────────────────────────────────────────────────

export function useFinding(findingId: string | undefined) {
  const { data, isLoading } = useQuery<AuditFindingRow>("SELECT * FROM audit_findings WHERE id = ?", [
    findingId ?? "",
  ]);
  return { finding: data[0] ?? null, isLoading };
}
export function useFindingBoats(findingId: string | undefined) {
  return useQuery<{ boat_id: string; name: string }>(
    `SELECT fb.boat_id, b.name FROM audit_finding_boats fb JOIN boats b ON b.id = fb.boat_id WHERE fb.finding_id = ?`,
    [findingId ?? ""],
  );
}
export function useFindingVehicles(findingId: string | undefined) {
  return useQuery<{ vehicle_id: string; description: string }>(
    `SELECT fv.vehicle_id, v.description FROM audit_finding_vehicles fv JOIN vehicles v ON v.id = fv.vehicle_id WHERE fv.finding_id = ?`,
    [findingId ?? ""],
  );
}
export function useFindingServices(findingId: string | undefined) {
  return useQuery<{ service_id: string; present: number; working: number; note: string | null }>(
    "SELECT service_id, present, working, note FROM audit_finding_services WHERE finding_id = ?",
    [findingId ?? ""],
  );
}
export function useFindingAmenities(findingId: string | undefined) {
  return useQuery<{ amenity_id: string; present: number; note: string | null }>(
    "SELECT amenity_id, present, note FROM audit_finding_amenities WHERE finding_id = ?",
    [findingId ?? ""],
  );
}
export function useFindingAnswers(findingId: string | undefined) {
  return useQuery<{ question_id: string; value: string; ticket_id: string | null }>(
    "SELECT question_id, value, ticket_id FROM audit_finding_answers WHERE finding_id = ?",
    [findingId ?? ""],
  );
}

export interface FindingInput {
  auditId: string;
  kind: AuditKind;
  /** Null for a proposed new location. */
  targetId: string | null;
  locationId: string | null;
  existingFindingId?: string | null;
  occupied?: boolean | null;
  contactId?: string | null;
  boatIds: string[];
  vehicleIds: string[];
  /** Applies at once when set. */
  statusId?: string | null;
  clearlyMarked?: boolean | null;
  mappedCorrectly?: boolean | null;
  services: ObservedService[];
  amenities: { amenityId: string; present: boolean; note: string | null }[];
  /** Every entry becomes a set_attribute Proposal when its value differs
   *  from what's on file — never applied directly. An Attribute is always
   *  applicable to a valid type; a null value means none was entered. */
  attributes: ObservedAttribute[];
  answers: { questionId: string; value: unknown }[];
  /** Proposals the form produced (gps, rename, create_location, …). Presence
   *  proposals are derived here from `services` / `amenities` / `attributes`. */
  proposals: { kind: ProposalKind; payload: Record<string, unknown> }[];
  expected: { hasCurrentLease: boolean; hasActiveReservation: boolean };
}

/**
 * Save a finding. One transaction: the finding and its parts, then what the
 * spec says applies at once (status, occupants, working flags, notes), then
 * the proposals that wait for finalize. The database marks the target
 * audited and closes the audit when nothing is left.
 */
export async function saveFinding(input: FindingInput, actorId: string): Promise<string> {
  return transact(async (tx) => {
    const unexpected =
      input.kind === "occupancy" && input.occupied != null
        ? unexpectedOccupancy({ occupied: input.occupied, ...input.expected })
        : false;
    const columns = {
      occupied: input.occupied == null ? null : input.occupied ? 1 : 0,
      contact_id: input.contactId ?? null,
      unexpected_occupancy: unexpected ? 1 : 0,
      clearly_marked: input.clearlyMarked == null ? null : input.clearlyMarked ? 1 : 0,
      mapped_correctly: input.mappedCorrectly == null ? null : input.mappedCorrectly ? 1 : 0,
      updated_at: stamp(),
    };
    let findingId = input.existingFindingId ?? null;
    if (findingId) {
      await update(tx, "audit_findings", findingId, columns);
      for (const t of [
        "audit_finding_boats",
        "audit_finding_vehicles",
        "audit_finding_services",
        "audit_finding_amenities",
        "audit_finding_answers",
      ]) {
        await tx.execute(`DELETE FROM ${t} WHERE finding_id = ?`, [findingId]);
      }
      await tx.execute("DELETE FROM audit_proposals WHERE finding_id = ? AND decision IS NULL", [findingId]);
    } else {
      findingId = await insert(tx, "audit_findings", {
        audit_id: input.auditId,
        target_id: input.targetId,
        recorded_by_id: actorId,
        recorded_at: stamp(),
        is_current: 1,
        ...columns,
      });
    }

    for (const boatId of input.boatIds) {
      await insert(tx, "audit_finding_boats", { finding_id: findingId, boat_id: boatId, is_current: 1 });
    }
    for (const vehicleId of input.vehicleIds) {
      await insert(tx, "audit_finding_vehicles", { finding_id: findingId, vehicle_id: vehicleId, is_current: 1 });
    }
    for (const s of input.services) {
      await insert(tx, "audit_finding_services", {
        finding_id: findingId,
        service_id: s.serviceId,
        present: s.present ? 1 : 0,
        working: s.working ? 1 : 0,
        note: s.note,
        is_current: 1,
      });
    }
    for (const a of input.amenities) {
      await insert(tx, "audit_finding_amenities", {
        finding_id: findingId,
        amenity_id: a.amenityId,
        present: a.present ? 1 : 0,
        note: a.note,
        is_current: 1,
      });
    }
    for (const ans of input.answers) {
      await insert(tx, "audit_finding_answers", {
        finding_id: findingId,
        question_id: ans.questionId,
        value: JSON.stringify(ans.value),
        is_current: 1,
      });
    }

    const loc = input.locationId;
    if (loc) {
      const locName =
        (await tx.getOptional<{ name: string }>("SELECT name FROM locations WHERE id = ?", [loc]))?.name ?? "?";

      if (input.statusId !== undefined && input.statusId !== null) {
        await update(tx, "locations", loc, { status_id: input.statusId });
      }

      // Occupants: what the auditor recorded is what is there. Boats moved in
      // leave their old slip; when that slip is in the same audit and still
      // pending, it is flagged for the next auditor.
      if (input.kind === "occupancy" && input.occupied != null) {
        const hereBoats = await tx.getAll<{ id: string; name: string }>(
          "SELECT id, name FROM boats WHERE location_id = ?",
          [loc],
        );
        for (const b of hereBoats) {
          if (!input.boatIds.includes(b.id)) {
            await update(tx, "boats", b.id, { location_id: null });
            await recordActivity(tx, {
              eventType: "boat.departed",
              summary: `${b.name} not found at ${locName} during audit`,
              subjectType: "boats",
              subjectId: b.id,
              actorId,
            });
          }
        }
        for (const boatId of input.boatIds) {
          const boat = await tx.getOptional<{ name: string; location_id: string | null }>(
            "SELECT name, location_id FROM boats WHERE id = ?",
            [boatId],
          );
          if (!boat || boat.location_id === loc) continue;
          await update(tx, "boats", boatId, { location_id: loc });
          await recordActivity(tx, {
            eventType: "boat.slip_changed",
            summary: `${boat.name} found at ${locName} during audit`,
            subjectType: "boats",
            subjectId: boatId,
            actorId,
          });
          if (boat.location_id) {
            const other = await tx.getOptional<{ id: string; displaced_note: string | null }>(
              "SELECT id, displaced_note FROM audit_targets WHERE audit_id = ? AND location_id = ? AND state = 'pending'",
              [input.auditId, boat.location_id],
            );
            if (other) {
              const note = `Expected ${boat.name}, found at ${locName}`;
              await update(tx, "audit_targets", other.id, {
                displaced_note: other.displaced_note ? `${other.displaced_note}; ${note}` : note,
              });
            }
          }
        }
        const hereVehicles = await tx.getAll<{ id: string; description: string }>(
          "SELECT id, description FROM vehicles WHERE location_id = ?",
          [loc],
        );
        for (const v of hereVehicles) {
          if (!input.vehicleIds.includes(v.id)) await update(tx, "vehicles", v.id, { location_id: null });
        }
        for (const vehicleId of input.vehicleIds) {
          await tx.execute("UPDATE vehicles SET location_id = ? WHERE id = ? AND location_id IS NOT ?", [
            loc,
            vehicleId,
            loc,
          ]);
        }
      }

      // Services: working and note apply to present rows; presence is a proposal.
      const currentServices = await tx.getAll<{ id: string; service_id: string; working: number; note: string | null }>(
        "SELECT id, service_id, working, note FROM location_services WHERE location_id = ?",
        [loc],
      );
      const diff = servicePresenceDiff(
        currentServices.map((c) => ({ serviceId: c.service_id, working: c.working === 1, note: c.note })),
        input.services,
      );
      for (const im of diff.immediate) {
        const row = currentServices.find((c) => c.service_id === im.serviceId)!;
        await update(tx, "location_services", row.id, { working: im.working ? 1 : 0, note: im.note });
      }
      for (const p of diff.proposals) {
        input.proposals.push({ kind: "set_service", payload: { service_id: p.serviceId, present: p.present } });
      }
      const currentAmenities = await tx.getAll<{ id: string; amenity_id: string; note: string | null }>(
        "SELECT id, amenity_id, note FROM location_amenities WHERE location_id = ?",
        [loc],
      );
      for (const a of input.amenities) {
        const row = currentAmenities.find((c) => c.amenity_id === a.amenityId);
        if (a.present !== (row !== undefined)) {
          input.proposals.push({ kind: "set_amenity", payload: { amenity_id: a.amenityId, present: a.present } });
        } else if (row && (row.note ?? null) !== (a.note ?? null)) {
          await update(tx, "location_amenities", row.id, { note: a.note });
        }
      }

      // Attributes: always a Proposal, even a value-only change — a
      // capacity limit is worth a second look every time it moves. An
      // Attribute is always applicable to a valid type; there is no
      // presence to toggle, only a value that may be unset (null).
      const currentAttributes = await tx.getAll<{
        attribute_id: string;
        value: number | null;
        value_text: string | null;
        note: string | null;
      }>("SELECT attribute_id, value, value_text, note FROM location_attributes WHERE location_id = ?", [loc]);
      const attrDiff = attributeDiff(
        currentAttributes.map((c) => ({
          attributeId: c.attribute_id,
          value: c.value,
          text: c.value_text,
          note: c.note,
        })),
        input.attributes,
      );
      for (const p of attrDiff.proposals) {
        input.proposals.push({
          kind: "set_attribute",
          payload: { attribute_id: p.attributeId, value: p.value, text: p.text, note: p.note },
        });
      }

      await recordActivity(tx, {
        eventType: "location.audited",
        summary: `${locName} audited${unexpected ? " — unexpected occupancy" : ""}`,
        subjectType: "locations",
        subjectId: loc,
        actorId,
      });
    }

    for (const p of input.proposals) {
      await insert(tx, "audit_proposals", {
        finding_id: findingId,
        kind: p.kind,
        structural: 0, // set by trigger from kind
        payload: JSON.stringify(p.payload),
        is_current: 1,
      });
    }
    return findingId;
  });
}

export function setAnswerTicket(findingId: string, questionId: string, ticketId: string): Promise<void> {
  return db.execute("UPDATE audit_finding_answers SET ticket_id = ? WHERE finding_id = ? AND question_id = ?", [
    ticketId,
    findingId,
    questionId,
  ]).then(() => undefined);
}

// ── proposals and decisions ──────────────────────────────────────────────

export function useAuditProposals(auditId: string | undefined) {
  return useQuery<AuditProposalRow>(
    `SELECT p.*, t.location_id AS target_location_id,
            COALESCE(t.location_name, json_extract(p.payload, '$.name')) AS location_name,
            u.name AS recorded_by_name
       FROM audit_proposals p
       JOIN audit_findings f ON f.id = p.finding_id
       LEFT JOIN audit_targets t ON t.id = f.target_id
       LEFT JOIN users u ON u.id = f.recorded_by_id
      WHERE f.audit_id = ?
      ORDER BY p.structural DESC, p.kind, t.position`,
    [auditId ?? ""],
  );
}
export function useProposalsForFinding(findingId: string | undefined) {
  return useQuery<AuditProposalRow>(
    `SELECT p.*, NULL AS target_location_id, NULL AS location_name, NULL AS recorded_by_name
       FROM audit_proposals p WHERE p.finding_id = ?`,
    [findingId ?? ""],
  );
}

export function decideProposal(
  proposalId: string,
  decision: "approved" | "rejected" | null,
  reason: string | null,
  actorId: string | null,
): Promise<void> {
  return update(db, "audit_proposals", proposalId, {
    decision,
    reason: decision === "rejected" ? reason : null,
    decided_by_id: decision ? actorId : null,
    decided_at: decision ? stamp() : null,
  });
}

/** Desk operations: online-only RPCs, since the database holds the checks. */
export async function closeAudit(auditId: string): Promise<void> {
  const { error } = await supabase.rpc("close_audit", { p_audit: auditId });
  if (error) throw new Error(error.message);
}
export async function finalizeAudit(auditId: string): Promise<void> {
  const { error } = await supabase.rpc("finalize_audit", { p_audit: auditId });
  if (error) throw new Error(error.message);
}

export function parseProposalPayload(row: AuditProposalRow): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(row.payload, {});
}
