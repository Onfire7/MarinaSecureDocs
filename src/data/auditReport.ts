import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import { useAudit, useAuditGaps, useAuditProposals, useAuditTargets, type AuditProposalRow, type AuditRow } from "./audits";
import { useLocations, useLocationTypes } from "./locations";
import { useAmenities, useAttributes, useServices } from "./services";
import { useMarinaName } from "./settings";
import { AUDIT_CATEGORIES, gapsOfTarget, type AuditCategory } from "../lib/audits";

// The audit report document: everything a reader outside the app needs to
// understand one audit, assembled once from the synced tables. Written for
// the report prototypes (src/pages/audits/prototype); the public share page
// will get the same shape from a server-side function keyed by the share's
// GUID, since a recipient has no Clerk identity and no PowerSync database.
// Keeping the document shape here means the page renders either source.
//
// Every join is on `id` - a join on a foreign key scans on PowerSync's local
// views (CLAUDE.md). The per-audit filters go through audit_findings by id.

export interface ReportService {
  name: string;
  present: boolean;
  working: boolean;
  note: string | null;
}
export interface ReportAmenity {
  name: string;
  present: boolean;
  note: string | null;
}
export interface ReportAnswer {
  prompt: string;
  kind: string;
  /** Parsed from the stored JSON: boolean for yes/no, string for choice/text, number for a meter. */
  value: unknown;
  ticketId: string | null;
}
export interface ReportProposal {
  id: string;
  kind: AuditProposalRow["kind"];
  structural: boolean;
  description: string;
  decision: "approved" | "rejected" | null;
  reason: string | null;
  recordedBy: string | null;
}
export interface ReportTicket {
  id: string;
  title: string;
  priority: string;
  status: string | null;
  open: boolean;
}
export interface ReportTarget {
  id: string;
  locationId: string | null;
  name: string;
  typeName: string | null;
  /** The parent location's name - what a reader calls "the area". */
  area: string | null;
  statusName: string | null;
  state: "pending" | "audited" | "not_audited";
  notAuditedReason: string | null;
  displacedNote: string | null;
  finding: {
    recordedBy: string | null;
    recordedAt: string;
    occupied: boolean | null;
    unexpectedOccupancy: boolean;
    clearlyMarked: boolean | null;
    mappedCorrectly: boolean | null;
  } | null;
  services: ReportService[];
  amenities: ReportAmenity[];
  answers: ReportAnswer[];
  proposals: ReportProposal[];
  tickets: ReportTicket[];
  /** Categories this audited location still has no answer for. */
  gaps: AuditCategory[];
}
export interface AuditReport {
  audit: AuditRow;
  marinaName: string;
  launchedBy: string | null;
  closedBy: string | null;
  finalizedBy: string | null;
  assignees: string[];
  targets: ReportTarget[];
  /** Proposals for locations that don't exist yet have no target row. */
  newLocationProposals: ReportProposal[];
  /** When the document was assembled - it is compiled live, not stored. */
  asOf: string;
}

interface FindingRow {
  id: string;
  target_id: string | null;
  recorded_by_id: string;
  recorded_by_name: string | null;
  recorded_at: string;
  occupied: number | null;
  unexpected_occupancy: number;
  clearly_marked: number | null;
  mapped_correctly: number | null;
}

export function useAuditReport(auditId: string | undefined): { report: AuditReport | null; isLoading: boolean } {
  const id = auditId ?? "";
  const audit = useAudit(auditId);
  const targets = useAuditTargets(auditId);
  const proposals = useAuditProposals(auditId);
  const gaps = useAuditGaps(auditId);
  const locations = useLocations();
  const types = useLocationTypes();
  const services = useServices();
  const amenities = useAmenities();
  const attributes = useAttributes();
  const people = useQuery<{ id: string; name: string }>("SELECT id, name FROM users");
  const marinaName = useMarinaName();
  const assignees = useQuery<{ user_name: string | null; role_name: string | null }>(
    `SELECT u.name AS user_name, r.name AS role_name
       FROM audit_assignees a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN roles r ON r.id = a.role_id
      WHERE a.audit_id = ?`,
    [id],
  );
  const findings = useQuery<FindingRow>(
    `SELECT f.id, f.target_id, f.recorded_by_id, u.name AS recorded_by_name, f.recorded_at,
            f.occupied, f.unexpected_occupancy, f.clearly_marked, f.mapped_correctly
       FROM audit_findings f
       LEFT JOIN users u ON u.id = f.recorded_by_id
      WHERE f.audit_id = ?`,
    [id],
  );
  const fServices = useQuery<{ finding_id: string; name: string; present: number; working: number; note: string | null }>(
    `SELECT fs.finding_id, s.name, fs.present, fs.working, fs.note
       FROM audit_finding_services fs
       JOIN audit_findings f ON f.id = fs.finding_id
       JOIN services s ON s.id = fs.service_id
      WHERE f.audit_id = ?
      ORDER BY s.position, s.name`,
    [id],
  );
  const fAmenities = useQuery<{ finding_id: string; name: string; present: number; note: string | null }>(
    `SELECT fa.finding_id, a.name, fa.present, fa.note
       FROM audit_finding_amenities fa
       JOIN audit_findings f ON f.id = fa.finding_id
       JOIN amenities a ON a.id = fa.amenity_id
      WHERE f.audit_id = ?
      ORDER BY a.position, a.name`,
    [id],
  );
  const fAnswers = useQuery<{ finding_id: string; prompt: string; kind: string; value: string; ticket_id: string | null; position: number }>(
    `SELECT fa.finding_id, q.prompt, q.kind, fa.value, fa.ticket_id, q.position
       FROM audit_finding_answers fa
       JOIN audit_findings f ON f.id = fa.finding_id
       JOIN audit_questions q ON q.id = fa.question_id
      WHERE f.audit_id = ?
      ORDER BY q.position`,
    [id],
  );
  const tickets = useQuery<{ id: string; title: string; priority: string; source_finding_id: string; status_name: string | null; is_terminal: number | null }>(
    `SELECT t.id, t.title, t.priority, t.source_finding_id, ts.name AS status_name, ts.is_terminal
       FROM tickets t
       JOIN audit_findings f ON f.id = t.source_finding_id
       LEFT JOIN ticket_statuses ts ON ts.id = t.status_id
      WHERE f.audit_id = ?
      ORDER BY t.created_at`,
    [id],
  );

  const sources = [
    targets, proposals, gaps, locations, types, services, amenities, attributes,
    people, assignees, findings, fServices, fAmenities, fAnswers, tickets,
  ];
  const settled = !audit.isLoading && sources.every((q) => !q.isLoading && !q.isFetching);

  const report = useMemo<AuditReport | null>(() => {
    if (!audit.audit || !settled) return null;
    const a = audit.audit;
    const nameOf = (list: { id: string; name: string }[], x: unknown) => list.find((r) => r.id === x)?.name ?? "?";
    const person = (uid: string | null) => (uid ? (people.data.find((p) => p.id === uid)?.name ?? null) : null);
    const locById = new Map(locations.data.map((l) => [l.id, l]));

    const describe = (p: AuditProposalRow): string => {
      const pl = parsePayload(p.payload);
      switch (p.kind) {
        case "create_location":
          return `New location ${pl.name} (${nameOf(types.data, pl.location_type_id)}${pl.parent_id ? ` under ${nameOf(locations.data, pl.parent_id)}` : ""})`;
        case "retire_location":
          return "Retire this location";
        case "rename":
          return `Rename to ${pl.name}`;
        case "retype":
          return `Change type to ${nameOf(types.data, pl.location_type_id)}`;
        case "reparent":
          return `Move under ${nameOf(locations.data, pl.parent_id)}`;
        case "move_placement":
          return "Move on the map";
        case "set_gps":
          return `GPS ${Number(pl.lat).toFixed(5)}, ${Number(pl.lng).toFixed(5)}`;
        case "set_service":
          return `${nameOf(services.data, pl.service_id)} ${pl.present ? "present" : "absent"}`;
        case "set_amenity":
          return `${nameOf(amenities.data, pl.amenity_id)} ${pl.present ? "present" : "absent"}`;
        case "set_attribute": {
          const attr = attributes.data.find((x) => x.id === pl.attribute_id);
          const shown = pl.text != null ? String(pl.text) : pl.value != null ? `${pl.value}${attr?.unit ? ` ${attr.unit}` : ""}` : null;
          return shown != null ? `${attr?.name ?? "?"} → ${shown}` : `${attr?.name ?? "?"} cleared`;
        }
        default:
          return p.kind;
      }
    };
    const toProposal = (p: AuditProposalRow): ReportProposal => ({
      id: p.id,
      kind: p.kind,
      structural: p.structural === 1,
      description: describe(p),
      decision: p.decision,
      reason: p.reason,
      recordedBy: p.recorded_by_name,
    });

    const findingByTarget = new Map(findings.data.filter((f) => f.target_id).map((f) => [f.target_id!, f]));
    const gapByTarget = new Map(gaps.data.map((g) => [g.target_id, g]));
    const group = <T extends { finding_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) (m.get(r.finding_id) ?? m.set(r.finding_id, []).get(r.finding_id)!).push(r);
      return m;
    };
    const svcBy = group(fServices.data);
    const amenBy = group(fAmenities.data);
    const ansBy = group(fAnswers.data);
    const propBy = new Map<string, AuditProposalRow[]>();
    for (const p of proposals.data) (propBy.get(p.finding_id) ?? propBy.set(p.finding_id, []).get(p.finding_id)!).push(p);
    const tktBy = new Map<string, typeof tickets.data>();
    for (const t of tickets.data) (tktBy.get(t.source_finding_id) ?? tktBy.set(t.source_finding_id, []).get(t.source_finding_id)!).push(t);

    const shaped: ReportTarget[] = targets.data.map((t) => {
      const f = findingByTarget.get(t.id) ?? null;
      const loc = t.location_id ? locById.get(t.location_id) : undefined;
      const parent = loc?.parent_id ? locById.get(loc.parent_id) : undefined;
      const g = gapByTarget.get(t.id);
      return {
        id: t.id,
        locationId: t.location_id,
        name: t.location_name,
        typeName: t.type_name,
        area: parent?.name ?? null,
        statusName: t.status_name,
        state: t.state,
        notAuditedReason: t.not_audited_reason,
        displacedNote: t.displaced_note,
        finding: f
          ? {
              recordedBy: f.recorded_by_name,
              recordedAt: f.recorded_at,
              occupied: f.occupied === null ? null : f.occupied === 1,
              unexpectedOccupancy: f.unexpected_occupancy === 1,
              clearlyMarked: f.clearly_marked === null ? null : f.clearly_marked === 1,
              mappedCorrectly: f.mapped_correctly === null ? null : f.mapped_correctly === 1,
            }
          : null,
        services: (f ? svcBy.get(f.id) ?? [] : []).map((s) => ({ name: s.name, present: s.present === 1, working: s.working === 1, note: s.note })),
        amenities: (f ? amenBy.get(f.id) ?? [] : []).map((s) => ({ name: s.name, present: s.present === 1, note: s.note })),
        answers: (f ? ansBy.get(f.id) ?? [] : []).map((r) => ({ prompt: r.prompt, kind: r.kind, value: parseJson(r.value), ticketId: r.ticket_id })),
        proposals: (f ? propBy.get(f.id) ?? [] : []).map(toProposal),
        tickets: (f ? tktBy.get(f.id) ?? [] : []).map((k) => ({ id: k.id, title: k.title, priority: k.priority, status: k.status_name, open: k.is_terminal !== 1 })),
        gaps: g
          ? gapsOfTarget(a, {
              targetId: g.target_id,
              ...Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c, g[c]])),
            } as Parameters<typeof gapsOfTarget>[1])
          : [],
      };
    });
    const targetFindingIds = new Set(findings.data.filter((f) => f.target_id).map((f) => f.id));
    const newLocationProposals = proposals.data.filter((p) => !targetFindingIds.has(p.finding_id)).map(toProposal);

    return {
      audit: a,
      marinaName,
      launchedBy: person(a.launched_by_id),
      closedBy: person(a.closed_by_id),
      finalizedBy: person(a.finalized_by_id),
      assignees: assignees.data.map((x) => x.user_name ?? x.role_name ?? "?"),
      targets: shaped,
      newLocationProposals,
      asOf: new Date().toISOString(),
    };
  }, [audit.audit, settled, targets.data, proposals.data, gaps.data, locations.data, types.data, services.data, amenities.data, attributes.data, people.data, marinaName, assignees.data, findings.data, fServices.data, fAmenities.data, fAnswers.data, tickets.data]);

  return { report, isLoading: !settled };
}

function parsePayload(payload: string | null): Record<string, unknown> {
  return (parseJson(payload) as Record<string, unknown> | null) ?? {};
}
function parseJson(text: string | null): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
