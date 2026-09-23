// PROTOTYPE — throwaway. The facts every report variant reads, derived once
// from the AuditReport document so the three layouts disagree only about
// presentation. What survives the prototype moves to src/lib/auditReport.ts
// with tests; nothing here is tested.
import type { AuditReport, ReportTarget } from "../../../data/auditReport";
import { CATEGORY_LABEL, type AuditCategory } from "../../../lib/audits";

export interface Summary {
  kind: "occupancy" | "status";
  status: string;
  targets: number;
  audited: number;
  notAudited: number;
  pending: number;
  coveragePct: number;
  /** Services recorded present but not working, with where. */
  broken: { service: string; location: string; note: string | null }[];
  /** Per service: how many audited locations have it, don't, and have it broken. */
  services: { name: string; present: number; absent: number; broken: number }[];
  amenities: { name: string; present: number; absent: number }[];
  notMarked: string[];
  notMapped: string[];
  unexpected: { location: string; occupied: boolean }[];
  occupied: number;
  vacant: number;
  proposals: { total: number; approved: number; rejected: number; undecided: number; structural: number };
  tickets: { total: number; open: number };
  /** Audited locations per unanswered category. */
  gaps: { category: AuditCategory; label: string; count: number }[];
  questions: { prompt: string; kind: string; no: number; yes: number; tally: Record<string, number> }[];
  auditors: string[];
  firstFinding: string | null;
  lastFinding: string | null;
}

export function summarize(r: AuditReport): Summary {
  const t = r.targets;
  const audited = t.filter((x) => x.state === "audited");
  const notAudited = t.filter((x) => x.state === "not_audited").length;
  const pending = t.filter((x) => x.state === "pending").length;
  const svc = new Map<string, { present: number; absent: number; broken: number }>();
  const amen = new Map<string, { present: number; absent: number }>();
  const broken: Summary["broken"] = [];
  const notMarked: string[] = [];
  const notMapped: string[] = [];
  const unexpected: Summary["unexpected"] = [];
  let occupied = 0;
  let vacant = 0;
  const q = new Map<string, { prompt: string; kind: string; no: number; yes: number; tally: Record<string, number> }>();
  const gapCount = new Map<AuditCategory, number>();
  const auditors = new Set<string>();
  const times: string[] = [];
  for (const x of audited) {
    if (x.finding) {
      if (x.finding.recordedBy) auditors.add(x.finding.recordedBy);
      times.push(x.finding.recordedAt);
      if (x.finding.clearlyMarked === false) notMarked.push(x.name);
      if (x.finding.mappedCorrectly === false) notMapped.push(x.name);
      if (x.finding.unexpectedOccupancy) unexpected.push({ location: x.name, occupied: x.finding.occupied === true });
      if (x.finding.occupied === true) occupied += 1;
      if (x.finding.occupied === false) vacant += 1;
    }
    for (const s of x.services) {
      const e = svc.get(s.name) ?? { present: 0, absent: 0, broken: 0 };
      if (s.present) e.present += 1;
      else e.absent += 1;
      if (s.present && !s.working) {
        e.broken += 1;
        broken.push({ service: s.name, location: x.name, note: s.note });
      }
      svc.set(s.name, e);
    }
    for (const a of x.amenities) {
      const e = amen.get(a.name) ?? { present: 0, absent: 0 };
      if (a.present) e.present += 1;
      else e.absent += 1;
      amen.set(a.name, e);
    }
    for (const a of x.answers) {
      const e = q.get(a.prompt) ?? { prompt: a.prompt, kind: a.kind, no: 0, yes: 0, tally: {} };
      if (a.value === false) e.no += 1;
      else if (a.value === true) e.yes += 1;
      else if (a.value != null) e.tally[String(a.value)] = (e.tally[String(a.value)] ?? 0) + 1;
      q.set(a.prompt, e);
    }
    for (const g of x.gaps) gapCount.set(g, (gapCount.get(g) ?? 0) + 1);
  }
  const allProposals = [...t.flatMap((x) => x.proposals), ...r.newLocationProposals];
  const tickets = t.flatMap((x) => x.tickets);
  times.sort();
  return {
    kind: r.audit.kind,
    status: r.audit.status,
    targets: t.length,
    audited: audited.length,
    notAudited,
    pending,
    coveragePct: t.length ? Math.round((audited.length / t.length) * 100) : 0,
    broken,
    services: [...svc.entries()].map(([name, v]) => ({ name, ...v })),
    amenities: [...amen.entries()].map(([name, v]) => ({ name, ...v })),
    notMarked,
    notMapped,
    unexpected,
    occupied,
    vacant,
    proposals: {
      total: allProposals.length,
      approved: allProposals.filter((p) => p.decision === "approved").length,
      rejected: allProposals.filter((p) => p.decision === "rejected").length,
      undecided: allProposals.filter((p) => p.decision === null).length,
      structural: allProposals.filter((p) => p.structural).length,
    },
    tickets: { total: tickets.length, open: tickets.filter((k) => k.open).length },
    gaps: [...gapCount.entries()].map(([category, count]) => ({ category, label: CATEGORY_LABEL[category], count })),
    questions: [...q.values()],
    auditors: [...auditors],
    firstFinding: times[0] ?? null,
    lastFinding: times[times.length - 1] ?? null,
  };
}

/** The executive summary as sentences - the part an email would carry verbatim. */
export function narrative(r: AuditReport, s: Summary): string[] {
  const out: string[] = [];
  const when = s.firstFinding && s.lastFinding ? `between ${fmtDate(s.firstFinding)} and ${fmtDate(s.lastFinding)}` : "";
  const who = s.auditors.length ? ` by ${list(s.auditors)}` : "";
  out.push(
    `${s.audited} of ${s.targets} locations were audited${who} ${when}`.replace(/\s+/g, " ").trim() +
      (s.notAudited ? `; ${s.notAudited} were not reached${r.audit.status !== "open" ? " before the audit closed" : ""}.` : "."),
  );
  if (s.kind === "status") {
    if (s.broken.length) {
      const byService = new Map<string, number>();
      for (const b of s.broken) byService.set(b.service, (byService.get(b.service) ?? 0) + 1);
      out.push(
        `${s.broken.length} service${s.broken.length === 1 ? " was" : "s were"} found not working: ${list([...byService.entries()].map(([k, v]) => `${k} at ${v} location${v === 1 ? "" : "s"}`))}.`,
      );
    } else if (s.audited) {
      out.push("Every service recorded was working.");
    }
    const markMap: string[] = [];
    if (s.notMarked.length) markMap.push(`${s.notMarked.length} not clearly marked`);
    if (s.notMapped.length) markMap.push(`${s.notMapped.length} placed wrongly on the map`);
    if (markMap.length) out.push(`Signage and mapping: ${list(markMap)}.`);
  } else {
    out.push(`${s.occupied} occupied, ${s.vacant} vacant.` + (s.unexpected.length ? ` ${s.unexpected.length} did not match the lease or reservation on file.` : " Every one matched what is on file."));
  }
  if (s.proposals.total) {
    const parts = [`${s.proposals.approved} approved`];
    if (s.proposals.rejected) parts.push(`${s.proposals.rejected} rejected`);
    if (s.proposals.undecided) parts.push(`${s.proposals.undecided} still to decide`);
    out.push(`${s.proposals.total} change${s.proposals.total === 1 ? "" : "s"} proposed: ${list(parts)}${s.proposals.structural ? `, ${s.proposals.structural} structural` : ""}.`);
  }
  if (s.tickets.total) out.push(`${s.tickets.total} ticket${s.tickets.total === 1 ? "" : "s"} raised, ${s.tickets.open} still open.`);
  if (s.gaps.length) out.push(`Still unanswered on audited locations: ${list(s.gaps.map((g) => `${g.label.toLowerCase()} (${g.count})`))}.`);
  return out;
}

/** What a reader should look at for one location, in a phrase or two. */
export function attention(x: ReportTarget): string[] {
  const out: string[] = [];
  for (const s of x.services) if (s.present && !s.working) out.push(`${s.name} not working${s.note ? ` - ${s.note}` : ""}`);
  if (x.finding?.clearlyMarked === false) out.push("not clearly marked");
  if (x.finding?.mappedCorrectly === false) out.push("wrong on the map");
  if (x.finding?.unexpectedOccupancy) out.push(x.finding.occupied ? "occupied, nothing on file" : "vacant, but leased or reserved");
  for (const a of x.answers) if (a.value === false) out.push(`${a.prompt.replace(/\?$/, "")}: No`);
  for (const p of x.proposals) if (p.decision === null) out.push(`${p.description} (undecided)`);
  for (const k of x.tickets) if (k.open) out.push(`ticket open: ${k.title}`);
  return out;
}

export function needsAttention(x: ReportTarget): boolean {
  return attention(x).length > 0 || x.tickets.some((t) => t.open);
}

/** One row per location for the location-level table. */
export interface LocationRow {
  target: ReportTarget;
  location: string;
  area: string;
  type: string;
  state: string;
  attention: string;
  changes: number;
  tickets: number;
  unanswered: string;
  recordedBy: string;
  recordedAt: string;
}
export function locationRows(r: AuditReport): LocationRow[] {
  return r.targets.map((x) => ({
    target: x,
    location: x.name,
    area: x.area ?? "",
    type: x.typeName ?? "",
    state: x.state === "not_audited" ? `not audited${x.notAuditedReason ? ` - ${x.notAuditedReason}` : ""}` : x.state,
    attention: attention(x).join("; "),
    changes: x.proposals.length,
    tickets: x.tickets.length,
    unanswered: x.gaps.map((g) => CATEGORY_LABEL[g]).join(", "),
    recordedBy: x.finding?.recordedBy ?? "",
    recordedAt: x.finding ? fmtDateTime(x.finding.recordedAt) : "",
  }));
}

/** One row per (location × item) for the item-level table. */
export interface ItemRow {
  targetId: string;
  location: string;
  area: string;
  type: string;
  category: "Service" | "Amenity" | "Question" | "Marked" | "Map" | "Occupancy" | "Change" | "Ticket";
  item: string;
  result: string;
  /** good / warn / bad / none - drives the badge, and "attention" filtering. */
  tone: "good" | "warn" | "bad" | "none";
  note: string;
  recordedBy: string;
}
export function itemRows(r: AuditReport): ItemRow[] {
  const rows: ItemRow[] = [];
  for (const x of r.targets) {
    if (!x.finding) continue;
    const base = { targetId: x.id, location: x.name, area: x.area ?? "", type: x.typeName ?? "", recordedBy: x.finding.recordedBy ?? "" };
    if (r.audit.kind === "occupancy") {
      rows.push({
        ...base,
        category: "Occupancy",
        item: "Occupied?",
        result: x.finding.occupied === null ? "-" : x.finding.occupied ? "Occupied" : "Vacant",
        tone: x.finding.unexpectedOccupancy ? "bad" : "good",
        note: x.finding.unexpectedOccupancy ? "does not match what is on file" : "",
      });
    }
    for (const s of x.services)
      rows.push({
        ...base,
        category: "Service",
        item: s.name,
        result: !s.present ? "Absent" : s.working ? "Working" : "Not working",
        tone: !s.present ? "none" : s.working ? "good" : "bad",
        note: s.note ?? "",
      });
    for (const a of x.amenities)
      rows.push({ ...base, category: "Amenity", item: a.name, result: a.present ? "Present" : "Absent", tone: a.present ? "good" : "none", note: a.note ?? "" });
    for (const a of x.answers)
      rows.push({
        ...base,
        category: "Question",
        item: a.prompt,
        result: a.value === true ? "Yes" : a.value === false ? "No" : a.value == null ? "-" : String(a.value),
        tone: a.value === false ? "bad" : a.value === true ? "good" : "none",
        note: a.ticketId ? "ticket raised" : "",
      });
    if (x.finding.clearlyMarked !== null)
      rows.push({ ...base, category: "Marked", item: "Clearly marked?", result: x.finding.clearlyMarked ? "Yes" : "No", tone: x.finding.clearlyMarked ? "good" : "bad", note: "" });
    if (x.finding.mappedCorrectly !== null)
      rows.push({ ...base, category: "Map", item: "Placed correctly?", result: x.finding.mappedCorrectly ? "Yes" : "No", tone: x.finding.mappedCorrectly ? "good" : "bad", note: "" });
    for (const p of x.proposals)
      rows.push({
        ...base,
        category: "Change",
        item: p.description,
        result: p.decision ?? "undecided",
        tone: p.decision === "approved" ? "good" : p.decision === "rejected" ? "none" : "warn",
        note: p.reason ?? "",
      });
    for (const k of x.tickets)
      rows.push({ ...base, category: "Ticket", item: k.title, result: k.status ?? (k.open ? "open" : "closed"), tone: k.open ? "warn" : "none", note: k.priority });
  }
  return rows;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
export function downloadCsv(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
export function statusWord(status: string): string {
  return status === "finalized" ? "Finalized" : status === "closed" ? "Closed - awaiting decisions" : "In progress";
}
