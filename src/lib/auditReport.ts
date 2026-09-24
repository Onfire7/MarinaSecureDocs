// The Audit Report's presentation, as pure functions over the document the
// database builds (docs/audits.md § Sharing the results;
// build_audit_report() in supabase/migrations/20260923000100_audit_report.sql
// is the other half and must produce exactly this shape). The sentences,
// the attention list, the wide rows and the CSV live here so the shared
// page, the in-app page and the emailed report render one way. Nothing
// here touches the database; src/lib/auditReport.test.ts is the spec.

export type AuditKind = "occupancy" | "status";
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

export interface ReportAudit {
  id: string;
  name: string;
  kind: AuditKind;
  status: "open" | "closed" | "finalized";
  launchedAt: string;
  closedAt: string | null;
  finalizedAt: string | null;
  includeAttributes: boolean;
  includeServices: boolean;
  includeAmenities: boolean;
  includeMarked: boolean;
  includeMap: boolean;
}
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
export interface ReportAttribute {
  name: string;
  unit: string | null;
  /** The Finding's proposed value when it made one, else what the location records; null for none. */
  value: string | null;
  proposed: boolean;
}
export interface ReportAnswer {
  prompt: string;
  kind: string;
  /** boolean for yes/no, string for choice/text, number for a meter, null for none. */
  value: unknown;
  ticketId: string | null;
}
export interface ReportProposal {
  id: string;
  kind: ProposalKind;
  structural: boolean;
  decision: "approved" | "rejected" | null;
  reason: string | null;
  recordedBy: string | null;
  /** The payload with ids resolved to names (serviceName, attributeName, …) and no coordinates. */
  payload: Record<string, unknown>;
}
export interface ReportTicket {
  id: string;
  title: string;
  priority: string;
  status: string | null;
  open: boolean;
}
export interface ReportFinding {
  recordedBy: string | null;
  recordedAt: string;
  occupied: boolean | null;
  unexpectedOccupancy: boolean;
  clearlyMarked: boolean | null;
  mappedCorrectly: boolean | null;
}
export interface ReportTarget {
  id: string;
  locationId: string | null;
  name: string;
  typeName: string | null;
  /** The parent location's name. */
  area: string | null;
  state: "pending" | "audited" | "not_audited";
  notAuditedReason: string | null;
  displacedNote: string | null;
  finding: ReportFinding | null;
  services: ReportService[];
  amenities: ReportAmenity[];
  attributes: ReportAttribute[];
  answers: ReportAnswer[];
  proposals: ReportProposal[];
  tickets: ReportTicket[];
}
/** Every catalogue entry valid for any type in the audit and every question
 *  asked, in catalogue order, so a location that wasn't reached still has
 *  the same columns. Empty for categories the audit doesn't ask about. */
export interface ReportColumns {
  services: string[];
  amenities: string[];
  attributes: { name: string; unit: string | null }[];
  questions: string[];
}
export interface AuditReport {
  audit: ReportAudit;
  marinaName: string;
  launchedBy: string | null;
  closedBy: string | null;
  finalizedBy: string | null;
  assignees: string[];
  columns: ReportColumns;
  targets: ReportTarget[];
  /** Proposals for locations that don't exist yet have no target row. */
  newLocationProposals: ReportProposal[];
  /** When the document was compiled. A finalized audit's never moves. */
  asOf: string;
}

// ── summary ──────────────────────────────────────────────────────────────

export interface Summary {
  kind: AuditKind;
  status: ReportAudit["status"];
  targets: number;
  audited: number;
  notAudited: number;
  pending: number;
  coveragePct: number;
  /** Services recorded present but not working, and where. */
  broken: { service: string; location: string; note: string | null }[];
  services: { name: string; present: number; absent: number; broken: number }[];
  amenities: { name: string; present: number; absent: number }[];
  notMarked: string[];
  notMapped: string[];
  unexpected: { location: string; occupied: boolean }[];
  occupied: number;
  vacant: number;
  proposals: { total: number; approved: number; rejected: number; undecided: number; structural: number };
  tickets: { total: number; open: number };
  questions: { prompt: string; kind: string; yes: number; no: number; tally: Record<string, number> }[];
  auditors: string[];
  firstFinding: string | null;
  lastFinding: string | null;
}

export function summarize(r: AuditReport): Summary {
  const t = r.targets;
  const audited = t.filter((x) => x.state === "audited");
  const svc = new Map<string, { present: number; absent: number; broken: number }>();
  const amen = new Map<string, { present: number; absent: number }>();
  const broken: Summary["broken"] = [];
  const notMarked: string[] = [];
  const notMapped: string[] = [];
  const unexpected: Summary["unexpected"] = [];
  let occupied = 0;
  let vacant = 0;
  const q = new Map<string, Summary["questions"][number]>();
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
      const e = q.get(a.prompt) ?? { prompt: a.prompt, kind: a.kind, yes: 0, no: 0, tally: {} };
      if (a.value === true) e.yes += 1;
      else if (a.value === false) e.no += 1;
      else if (a.value != null && a.value !== "") e.tally[String(a.value)] = (e.tally[String(a.value)] ?? 0) + 1;
      q.set(a.prompt, e);
    }
  }
  // Column order is the catalogue's; a service no finding recorded still
  // exists as a column, so it is listed with zeros.
  const services = r.columns.services.map((name) => ({ name, ...(svc.get(name) ?? { present: 0, absent: 0, broken: 0 }) }));
  const amenities = r.columns.amenities.map((name) => ({ name, ...(amen.get(name) ?? { present: 0, absent: 0 }) }));
  const all = [...t.flatMap((x) => x.proposals), ...r.newLocationProposals];
  const tickets = t.flatMap((x) => x.tickets);
  times.sort();
  return {
    kind: r.audit.kind,
    status: r.audit.status,
    targets: t.length,
    audited: audited.length,
    notAudited: t.filter((x) => x.state === "not_audited").length,
    pending: t.filter((x) => x.state === "pending").length,
    coveragePct: t.length ? Math.round((audited.length / t.length) * 100) : 0,
    broken,
    services,
    amenities,
    notMarked,
    notMapped,
    unexpected,
    occupied,
    vacant,
    proposals: {
      total: all.length,
      approved: all.filter((p) => p.decision === "approved").length,
      rejected: all.filter((p) => p.decision === "rejected").length,
      undecided: all.filter((p) => p.decision === null).length,
      structural: all.filter((p) => p.structural).length,
    },
    tickets: { total: tickets.length, open: tickets.filter((k) => k.open).length },
    questions: r.columns.questions.map((prompt) => q.get(prompt) ?? { prompt, kind: "yes_no", yes: 0, no: 0, tally: {} }),
    auditors: [...auditors],
    firstFinding: times[0] ?? null,
    lastFinding: times[times.length - 1] ?? null,
  };
}

/** The executive summary as sentences - what an email carries verbatim. */
export function narrative(r: AuditReport, s: Summary): string[] {
  const out: string[] = [];
  const who = s.auditors.length ? ` by ${list(s.auditors)}` : "";
  const when =
    s.firstFinding && s.lastFinding
      ? fmtDate(s.firstFinding) === fmtDate(s.lastFinding)
        ? ` on ${fmtDate(s.firstFinding)}`
        : ` between ${fmtDate(s.firstFinding)} and ${fmtDate(s.lastFinding)}`
      : "";
  const notReached = s.notAudited
    ? `; ${s.notAudited} ${s.notAudited === 1 ? "was" : "were"} not reached${r.audit.status !== "open" ? " before the audit closed" : ""}.`
    : ".";
  const stillToVisit = s.pending ? ` ${s.pending} ${s.pending === 1 ? "is" : "are"} still to visit.` : "";
  out.push(`${s.audited} of ${s.targets} locations ${s.audited === 1 ? "was" : "were"} audited${who}${when}${notReached}${stillToVisit}`);
  if (s.kind === "status") {
    if (s.broken.length) {
      const by = new Map<string, number>();
      for (const b of s.broken) by.set(b.service, (by.get(b.service) ?? 0) + 1);
      out.push(
        `${s.broken.length} service${s.broken.length === 1 ? " was" : "s were"} found not working: ${list(
          [...by.entries()].map(([k, v]) => `${k} at ${v} location${v === 1 ? "" : "s"}`),
        )}.`,
      );
    } else if (s.audited) {
      out.push("Every service recorded was working.");
    }
    const parts: string[] = [];
    if (s.notMarked.length) parts.push(`${s.notMarked.length} not clearly marked`);
    if (s.notMapped.length) parts.push(`${s.notMapped.length} placed wrongly on the map`);
    if (parts.length) out.push(`Signage and mapping: ${list(parts)}.`);
  } else if (s.audited) {
    out.push(
      `${s.occupied} occupied, ${s.vacant} vacant.` +
        (s.unexpected.length
          ? ` ${s.unexpected.length} did not match the lease or reservation on file.`
          : " Every one matched what is on file."),
    );
  }
  if (s.proposals.total) {
    const parts = [`${s.proposals.approved} approved`];
    if (s.proposals.rejected) parts.push(`${s.proposals.rejected} rejected`);
    if (s.proposals.undecided) parts.push(`${s.proposals.undecided} still to decide`);
    out.push(
      `${s.proposals.total} change${s.proposals.total === 1 ? "" : "s"} proposed: ${list(parts)}${
        s.proposals.structural ? `, ${s.proposals.structural} structural` : ""
      }.`,
    );
  }
  if (s.tickets.total) {
    out.push(`${s.tickets.total} ticket${s.tickets.total === 1 ? "" : "s"} raised, ${s.tickets.open} still open.`);
  }
  return out;
}

// ── attention ────────────────────────────────────────────────────────────

/**
 * What a reader should look at for one location, in words.
 *
 * Notes ARE here, wherever they were recorded: the Notes column of the
 * table is the same text, and a reader should not have to cross-reference
 * two tables to find out that the auditor wrote "tap drips".
 *
 * Undecided Proposals are deliberately NOT here. Every Attribute answer is
 * a Proposal by design, so an audit of any size carries hundreds of them
 * before anyone has finalized it - on the Campgrounds audit, 402 - and
 * listing each one put every location in "Needs attention" and buried the
 * things that are actually wrong. A Proposal awaiting a decision is the
 * approval queue's business, on the audit page, where it can be acted on;
 * the report says how many are outstanding in one line of the summary.
 * What belongs here is what a manager would want to send somebody to look
 * at.
 */
export function attention(x: ReportTarget): string[] {
  const out: string[] = [];
  // A note is somebody typing on a phone in the rain: they only do it when
  // there is something to say. One on a service that is NOT working is
  // already the reason for that line; anywhere else it is its own.
  for (const s of x.services) {
    if (s.present && !s.working) out.push(`${s.name} not working${s.note ? ` - ${s.note}` : ""}`);
    else if (s.note) out.push(`${s.name}: ${s.note}`);
  }
  for (const a of x.amenities) if (a.note) out.push(`${a.name}: ${a.note}`);
  if (x.finding?.clearlyMarked === false) out.push("not clearly marked");
  if (x.finding?.mappedCorrectly === false) out.push("wrong on the map");
  if (x.finding?.unexpectedOccupancy) out.push(x.finding.occupied ? "occupied, nothing on file" : "vacant, but leased or reserved");
  for (const a of x.answers) if (a.value === false) out.push(`${a.prompt.replace(/\?$/, "")}: No`);
  for (const k of x.tickets) if (k.open) out.push(`ticket open: ${k.title}`);
  return out;
}
export function needsAttention(x: ReportTarget): boolean {
  return attention(x).length > 0;
}

export function describeProposal(p: ReportProposal): string {
  const pl = p.payload;
  const str = (k: string) => (pl[k] == null ? null : String(pl[k]));
  switch (p.kind) {
    case "create_location":
      return `New location ${str("name") ?? "?"} (${str("locationTypeName") ?? "?"}${str("parentName") ? ` under ${str("parentName")}` : ""})`;
    case "retire_location":
      return "Retire this location";
    case "rename":
      return `Rename to ${str("name") ?? "?"}`;
    case "retype":
      return `Change type to ${str("locationTypeName") ?? "?"}`;
    case "reparent":
      return `Move under ${str("parentName") ?? "?"}`;
    case "move_placement":
      return "Move on the map";
    case "set_gps":
      return "GPS captured";
    case "set_service":
      return `${str("serviceName") ?? "?"} ${pl.present ? "present" : "absent"}`;
    case "set_amenity":
      return `${str("amenityName") ?? "?"} ${pl.present ? "present" : "absent"}`;
    case "set_attribute": {
      const name = str("attributeName") ?? "?";
      const shown = str("text") ?? (str("value") != null ? `${str("value")}${str("attributeUnit") ? ` ${str("attributeUnit")}` : ""}` : null);
      return shown != null ? `${name} → ${shown}` : `${name} cleared`;
    }
    default:
      return p.kind;
  }
}

// ── rows ─────────────────────────────────────────────────────────────────

export const DASH = "-";

/** The per-location table's data columns, in order: only what the audit asked. */
export function wideHeaders(r: AuditReport): string[] {
  return [
    ...(r.audit.kind === "occupancy" ? ["Occupied"] : []),
    ...r.columns.attributes.map((a) => a.name),
    ...r.columns.services,
    ...r.columns.amenities,
    ...r.columns.questions,
    ...(r.audit.kind === "status" && r.audit.includeMarked ? ["Marked"] : []),
    ...(r.audit.kind === "status" && r.audit.includeMap ? ["Map"] : []),
  ];
}

export interface WideRow {
  target: ReportTarget;
  /** Keyed by header; the fixed vocabulary in docs/audits.md. */
  cells: Record<string, string>;
  notes: string;
}
export function wideRows(r: AuditReport): WideRow[] {
  const yesNo = (v: boolean | null | undefined) => (v == null ? DASH : v ? "Yes" : "No");
  return r.targets.map((t) => {
    const cells: Record<string, string> = {};
    const f = t.finding;
    if (r.audit.kind === "occupancy") {
      cells["Occupied"] =
        !f || f.occupied === null ? DASH : `${f.occupied ? "Occupied" : "Vacant"}${f.unexpectedOccupancy ? " !" : ""}`;
    }
    for (const c of r.columns.attributes) {
      const a = t.attributes.find((x) => x.name === c.name);
      cells[c.name] =
        a?.value != null ? `${a.value}${c.unit && /^-?[\d.]+$/.test(a.value) ? ` ${c.unit}` : ""}${a.proposed ? " *" : ""}` : DASH;
    }
    for (const name of r.columns.services) {
      const s = t.services.find((x) => x.name === name);
      cells[name] = !s ? DASH : !s.present ? "Absent" : s.working ? "Working" : "Not working";
    }
    for (const name of r.columns.amenities) {
      const a = t.amenities.find((x) => x.name === name);
      cells[name] = !a ? DASH : a.present ? "Yes" : "No";
    }
    for (const prompt of r.columns.questions) {
      const a = t.answers.find((x) => x.prompt === prompt);
      cells[prompt] = !a || a.value == null || a.value === "" ? DASH : a.value === true ? "Yes" : a.value === false ? "No" : String(a.value);
    }
    if (r.audit.kind === "status" && r.audit.includeMarked) cells["Marked"] = yesNo(f?.clearlyMarked);
    if (r.audit.kind === "status" && r.audit.includeMap) cells["Map"] = yesNo(f?.mappedCorrectly);
    const notes =
      t.state === "not_audited"
        ? `not audited${t.notAuditedReason ? ` · ${t.notAuditedReason}` : ""}`
        : [
            ...t.services.filter((s) => s.note).map((s) => `${s.name}: ${s.note}`),
            ...t.amenities.filter((a) => a.note).map((a) => `${a.name}: ${a.note}`),
          ].join("; ");
    return { target: t, cells, notes };
  });
}

export type ItemCategory = "Occupancy" | "Service" | "Amenity" | "Attribute" | "Question" | "Marked" | "Map" | "Change" | "Ticket";
export type Tone = "good" | "warn" | "bad" | "none";
export interface ItemRow {
  targetId: string;
  location: string;
  area: string;
  type: string;
  category: ItemCategory;
  item: string;
  result: string;
  tone: Tone;
  note: string;
  recordedBy: string;
}
export function itemRows(r: AuditReport): ItemRow[] {
  const rows: ItemRow[] = [];
  for (const x of r.targets) {
    if (!x.finding) continue;
    const f = x.finding;
    const base = { targetId: x.id, location: x.name, area: x.area ?? "", type: x.typeName ?? "", recordedBy: f.recordedBy ?? "" };
    if (r.audit.kind === "occupancy") {
      rows.push({
        ...base,
        category: "Occupancy",
        item: "Occupied?",
        result: f.occupied === null ? DASH : f.occupied ? "Occupied" : "Vacant",
        tone: f.unexpectedOccupancy ? "bad" : "good",
        note: f.unexpectedOccupancy ? "does not match what is on file" : "",
      });
    }
    for (const a of x.attributes)
      if (a.value != null)
        rows.push({ ...base, category: "Attribute", item: a.name, result: `${a.value}${a.proposed ? " *" : ""}`, tone: "none", note: a.proposed ? "proposed by this audit" : "" });
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
        result: a.value === true ? "Yes" : a.value === false ? "No" : a.value == null || a.value === "" ? DASH : String(a.value),
        tone: a.value === false ? "bad" : a.value === true ? "good" : "none",
        note: a.ticketId ? "ticket raised" : "",
      });
    if (r.audit.kind === "status" && r.audit.includeMarked && f.clearlyMarked !== null)
      rows.push({ ...base, category: "Marked", item: "Clearly marked?", result: f.clearlyMarked ? "Yes" : "No", tone: f.clearlyMarked ? "good" : "bad", note: "" });
    if (r.audit.kind === "status" && r.audit.includeMap && f.mappedCorrectly !== null)
      rows.push({ ...base, category: "Map", item: "Placed correctly?", result: f.mappedCorrectly ? "Yes" : "No", tone: f.mappedCorrectly ? "good" : "bad", note: "" });
    // Decided changes are an outcome and belong in the report. An undecided
    // one is a queue item, and there are hundreds of them before finalize
    // (see attention()); the value it proposes already shows against the
    // Attribute it belongs to, marked with a *.
    for (const p of x.proposals)
      if (p.decision !== null)
        rows.push({
          ...base,
          category: "Change",
          item: describeProposal(p),
          result: p.decision,
          tone: p.decision === "approved" ? "good" : "none",
          note: p.reason ?? "",
        });
    for (const k of x.tickets)
      rows.push({ ...base, category: "Ticket", item: k.title, result: k.status ?? (k.open ? "open" : "closed"), tone: k.open ? "warn" : "none", note: k.priority });
  }
  return rows;
}

// ── export ───────────────────────────────────────────────────────────────

export const WIDE_FIXED_HEADERS = ["Location", "Area", "Type", "State"] as const;
export const WIDE_TAIL_HEADERS = ["Notes", "Changes", "Tickets", "Recorded by", "Recorded at"] as const;
export const ITEM_HEADERS = ["Location", "Area", "Type", "Category", "Item", "Result", "Note", "Recorded by"] as const;

export function wideTable(r: AuditReport, rows: WideRow[]): { headers: string[]; rows: (string | number)[][] } {
  const data = wideHeaders(r);
  return {
    headers: [...WIDE_FIXED_HEADERS, ...data, ...WIDE_TAIL_HEADERS],
    rows: rows.map((w) => [
      w.target.name,
      w.target.area ?? "",
      w.target.typeName ?? "",
      w.target.state === "not_audited" ? "not audited" : w.target.state,
      ...data.map((h) => w.cells[h] ?? DASH),
      w.notes,
      w.target.proposals.length,
      w.target.tickets.length,
      w.target.finding?.recordedBy ?? "",
      w.target.finding ? fmtDateTime(w.target.finding.recordedAt) : "",
    ]),
  };
}
export function itemTable(rows: ItemRow[]): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: [...ITEM_HEADERS],
    rows: rows.map((x) => [x.location, x.area, x.type, x.category, x.item, x.result, x.note, x.recordedBy]),
  };
}
export function summaryTable(r: AuditReport, s: Summary): (string | number)[][] {
  return [
    ["Audit", r.audit.name],
    ["Marina", r.marinaName],
    ["Kind", r.audit.kind],
    ["Status", statusWord(r.audit.status)],
    ["Launched", fmtDate(r.audit.launchedAt)],
    ["Closed", r.audit.closedAt ? fmtDate(r.audit.closedAt) : ""],
    ["Finalized", r.audit.finalizedAt ? fmtDate(r.audit.finalizedAt) : ""],
    ["As of", fmtDateTime(r.asOf)],
    ["Locations", s.targets],
    ["Audited", s.audited],
    ["Not audited", s.notAudited],
    ["Need attention", r.targets.filter(needsAttention).length],
    ...(s.kind === "status" ? [["Services not working", s.broken.length] as (string | number)[]] : [["Unexpected occupancy", s.unexpected.length] as (string | number)[]]),
    ["Changes proposed", s.proposals.total],
    ["Changes approved", s.proposals.approved],
    ["Changes undecided", s.proposals.undecided],
    ["Tickets raised", s.tickets.total],
    ["Tickets open", s.tickets.open],
    [],
    ...narrative(r, s).map((line) => [line]),
  ];
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const t = String(v ?? "");
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\n");
}

/** The one value every target shares, or null when they differ (or there
 *  are none). The page hides a Type or Area that would be the same on every
 *  row - an audit of one campground needn't say "Campsite · Campgrounds"
 *  fifty times. */
export function uniformValue(values: (string | null)[]): string | null {
  if (values.length === 0) return null;
  const first = values[0];
  return first != null && values.every((v) => v === first) ? first : null;
}

// ── words ────────────────────────────────────────────────────────────────

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
export function statusWord(status: ReportAudit["status"]): string {
  return status === "finalized" ? "Finalized" : status === "closed" ? "Closed - awaiting decisions" : "In progress";
}
