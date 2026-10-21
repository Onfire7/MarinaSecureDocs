// The Shift Report document and its compiler (src/pages/reports/
// ShiftReportPage.spec.md § The document). Pure: the data layer gathers the
// rows, this turns them into the document that is stored at End of Shift and
// rendered everywhere after. The document holds facts and stable keys, never
// sentences, so every viewer reads it in their own language.
import { doorCheckSummary, doorStateLabel, normalizeItemType, questionAnswerSummary, type DoorCheckResult, type ItemResult, type QuestionResult, type VerifyTaskResult } from "./checklists";
import type { VehicleUse } from "./shiftReport";

export type Mark = "ok" | "missed" | "exception";
export type Tone = "bad" | "warn";

/** A short result for an item: a key under reports:result, with values. */
export interface Phrase {
  key: string;
  values?: Record<string, string>;
}

export interface RecordItem {
  id: string;
  /** "checkin" or a checklist item type. */
  kind: string;
  label: string;
  /** The checklist it came from; a check-in's is the checklist that expected it. */
  source: string | null;
  at: string | null;
  result: Phrase;
  note: string | null;
  mark: Mark;
}

export interface LocationCard {
  id: string | null;
  name: string;
  /** Ancestor names, root first; empty at the root. */
  path: string[];
  items: RecordItem[];
  checkIns: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface AttentionLine {
  /** A key under reports:attention. */
  kind: string;
  tone: Tone;
  where: string;
  at: string | null;
  values: Record<string, string>;
  /** Where it can be fixed, on the review: a checklist to open. */
  checklistId?: string;
}

export interface DocIncident {
  id: string;
  title: string;
  typeName: string | null;
  targetLabel: string | null;
  createdAt: string;
  status: string;
  details: string | null;
  photos: string[];
}

export interface DocTicket {
  id: string;
  title: string;
  priority: string;
  targetLabel: string | null;
  createdAt: string;
  origin: string | null;
  status: string;
  assignee: string | null;
  description: string | null;
  photos: string[];
}

export interface DocChecklist {
  id: string;
  name: string;
  done: number;
  total: number;
  completedAt: string | null;
  dueBy: string | null;
  previousShiftItems: number;
}

export interface ShiftReportDoc {
  version: 1;
  marinaName: string;
  shift: {
    id: string;
    guardId: string;
    guardName: string;
    startedAt: string;
    endedAt: string | null;
    endedBy: { kind: "checklist"; name: string } | { kind: "button" } | null;
  };
  note: string | null;
  checkIns: number;
  checklists: DocChecklist[];
  attention: AttentionLine[];
  incidents: DocIncident[];
  tickets: DocTicket[];
  notes: { id: string; targetLabel: string | null; createdAt: string; body: string }[];
  vehicles: VehicleUse[];
  locations: LocationCard[];
}

// ---- inputs

export interface InCheckIn {
  id: string;
  checkpoint_id: string | null;
  checkpoint_name: string | null;
  timestamp: string;
  method: string;
  reason: string | null;
  within_radius: number | boolean | null;
}
export interface InCheckpoint {
  id: string;
  name: string;
  location_id: string | null;
}
export interface InLocation {
  id: string;
  name: string;
  parent_id: string | null;
}
export interface InInstance {
  id: string;
  template_name: string | null;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  due_by: string | null;
}
export interface InSection {
  id: string;
  instance_id: string;
  template_section_id: string | null;
  label: string;
  location_id: string | null;
  due_by: string | null;
}
export interface InItem {
  id: string;
  section_id: string;
  type: string;
  label: string;
  completed_at: string | null;
  result: string | null;
  note: string | null;
}
export interface InSectionCheckpoint {
  section_id: string;
  checkpoint_id: string;
}
export interface InIncident {
  id: string;
  title: string;
  type_name: string | null;
  target_label: string | null;
  created_at: string;
  status_name: string;
  status_is_terminal: number | boolean;
  details: string | null;
}
export interface InTicket {
  id: string;
  title: string;
  priority: string;
  target_label: string | null;
  created_at: string;
  status_name: string;
  assignee_name: string | null;
  description: string | null;
  origin: string | null;
}
export interface InNote {
  id: string;
  target_label: string | null;
  created_at: string;
  body: string;
}

export interface CompileInputs {
  marinaName: string;
  shift: {
    id: string;
    guard_id: string;
    guard_name: string | null;
    started_at: string;
    ended_at: string | null;
    end_of_shift_checklist_id: string | null;
  };
  /** The window's end for an open shift; defaults to now. */
  now?: number;
  note?: string | null;
  checkIns: InCheckIn[];
  checkpoints: InCheckpoint[];
  locations: InLocation[];
  instances: InInstance[];
  sections: InSection[];
  items: InItem[];
  sectionCheckpoints: InSectionCheckpoint[];
  incidents: InIncident[];
  tickets: InTicket[];
  notes: InNote[];
  vehicles: VehicleUse[];
}

const ms = (t: string | null | undefined) => (t ? Date.parse(t) : NaN);
const inWindow = (t: string | null | undefined, w: { start: number; end: number }) => {
  const x = ms(t);
  return !Number.isNaN(x) && x >= w.start && x <= w.end;
};
const truthy = (v: number | boolean | null | undefined) => v === true || v === 1;

/** Checklists that belong to the shift (spec § Which checklists belong). */
export function checklistsInShift(
  instances: InInstance[],
  sections: InSection[],
  items: InItem[],
  window: { start: number; end: number },
): InInstance[] {
  const sectionsOf = new Map<string, InSection[]>();
  for (const s of sections) sectionsOf.set(s.instance_id, [...(sectionsOf.get(s.instance_id) ?? []), s]);
  const itemsOf = new Map<string, InItem[]>();
  for (const i of items) itemsOf.set(i.section_id, [...(itemsOf.get(i.section_id) ?? []), i]);
  return instances.filter((inst) => {
    if (inWindow(inst.created_at, window)) return true;
    const secs = sectionsOf.get(inst.id) ?? [];
    if (secs.some((s) => inWindow(s.due_by, window))) return true;
    return secs.some((s) => (itemsOf.get(s.id) ?? []).some((i) => inWindow(i.completed_at, window)));
  });
}

function parseResult(raw: string | null): ItemResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ItemResult;
  } catch {
    return null;
  }
}

/** An item's result as a phrase and a mark. Open at End of Shift is missed. */
export function readItem(item: InItem, openAtEnd: boolean): { result: Phrase; mark: Mark; exception?: AttentionLine["kind"]; values?: Record<string, string> } {
  const type = normalizeItemType(item.type);
  const r = parseResult(item.result);
  if (openAtEnd || !r) return { result: { key: "notDone" }, mark: "missed" };
  switch (type) {
    case "door_check":
    case "lock_check": {
      const s = doorCheckSummary(r as DoorCheckResult);
      const found = s.initial ? doorStateLabel(s.initial) : "";
      const left = s.final ? doorStateLabel(s.final) : "";
      const expected = doorStateLabel(s.expected);
      if (s.foundKnown && !s.foundAsExpected) {
        return {
          result: { key: "foundLeft", values: { found, left } },
          mark: "exception",
          exception: "doorFound",
          values: { door: item.label, found, expected, left },
        };
      }
      return { result: { key: "state", values: { state: left || expected } }, mark: "ok" };
    }
    case "verify_task": {
      const v = r as VerifyTaskResult;
      if (v.outcome === "confirmed") return { result: { key: "confirmed" }, mark: "ok" };
      return {
        result: { key: v.outcome === "rejected_ticket" ? "rejectedTicket" : "rejected" },
        mark: "exception",
        exception: "verifyRejected",
        values: { task: item.label, reason: v.reason ?? "" },
      };
    }
    case "meter_reading": {
      const m = r as { value?: number };
      return { result: { key: "reading", values: { value: String(m.value ?? "") } }, mark: "ok" };
    }
    case "question":
      return { result: { key: "answer", values: { answer: questionAnswerSummary(r as QuestionResult) } }, mark: "ok" };
    default:
      return { result: { key: "done" }, mark: "ok" };
  }
}

/** Ancestor names, root first, for a location. */
function pathOf(id: string | null, byId: Map<string, InLocation>): string[] {
  const names: string[] = [];
  let cur = id ? byId.get(id) : undefined;
  const seen = new Set<string>();
  while (cur && cur.parent_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.parent_id);
    if (!parent) break;
    names.unshift(parent.name);
    cur = parent;
  }
  return names;
}

export function compileShiftReport(input: CompileInputs): ShiftReportDoc {
  const window = {
    start: ms(input.shift.started_at),
    end: input.shift.ended_at ? ms(input.shift.ended_at) : (input.now ?? Date.now()),
  };
  const locById = new Map(input.locations.map((l) => [l.id, l]));
  const cpById = new Map(input.checkpoints.map((c) => [c.id, c]));
  const where = (locationId: string | null | undefined): string => {
    const l = locationId ? locById.get(locationId) : undefined;
    return l ? [...pathOf(l.id, locById), l.name].join(" › ") : "";
  };

  // ---- checklists and their items
  const mine = checklistsInShift(input.instances, input.sections, input.items, window);
  const mineIds = new Set(mine.map((i) => i.id));
  const sections = input.sections.filter((s) => mineIds.has(s.instance_id));
  const instanceById = new Map(mine.map((i) => [i.id, i]));

  const attention: AttentionLine[] = [];
  const cards = new Map<string, LocationCard>();
  const cardFor = (locationId: string | null, fallbackName: string): LocationCard => {
    const key = locationId ?? `checklist:${fallbackName}`;
    let card = cards.get(key);
    if (!card) {
      const l = locationId ? locById.get(locationId) : undefined;
      card = {
        id: locationId,
        name: l?.name ?? fallbackName,
        path: l ? pathOf(l.id, locById) : [],
        items: [],
        checkIns: 0,
        firstAt: null,
        lastAt: null,
      };
      cards.set(key, card);
    }
    return card;
  };
  const push = (card: LocationCard, item: RecordItem) => {
    card.items.push(item);
    if (item.at) {
      if (!card.firstAt || item.at < card.firstAt) card.firstAt = item.at;
      if (!card.lastAt || item.at > card.lastAt) card.lastAt = item.at;
    }
  };

  const checklists: DocChecklist[] = [];
  for (const inst of mine) {
    const name = inst.template_name ?? "Checklist";
    const secs = sections.filter((s) => s.instance_id === inst.id);
    let done = 0;
    let total = 0;
    let previous = 0;
    for (const sec of secs) {
      const items = input.items.filter((i) => i.section_id === sec.id);
      for (const it of items) {
        const completed = ms(it.completed_at);
        if (!Number.isNaN(completed) && completed < window.start) {
          previous++;
          continue;
        }
        const openAtEnd = Number.isNaN(completed) || completed > window.end;
        total++;
        if (!openAtEnd) done++;
        const read = readItem(it, openAtEnd);
        const card = cardFor(sec.location_id, name);
        push(card, {
          id: it.id,
          kind: normalizeItemType(it.type),
          label: it.label,
          source: name,
          at: openAtEnd ? null : it.completed_at,
          result: read.result,
          note: it.note,
          mark: read.mark,
        });
        if (read.exception && read.values) {
          attention.push({
            kind: read.exception,
            tone: "bad",
            where: where(sec.location_id) || name,
            at: it.completed_at,
            values: read.values,
            checklistId: inst.id,
          });
        }
      }
    }
    checklists.push({
      id: inst.id,
      name,
      done,
      total,
      completedAt: inst.completed_at,
      dueBy: inst.due_by,
      previousShiftItems: previous,
    });
    if (done < total) {
      attention.push({
        kind: "unfinished",
        tone: "bad",
        where: name,
        at: null,
        values: { name, done: String(done), total: String(total), due: inst.due_by ?? "" },
        checklistId: inst.id,
      });
    }
  }

  // ---- check-ins: the visits the guard made. Never "missed": which
  // checkpoints a shift requires is ROADMAP work (spec § Checkpoints are
  // never "missed"). A check-in's checklist is the one whose section names
  // its checkpoint, when there is one.
  const checklistNaming = new Map<string, string>();
  for (const sc of input.sectionCheckpoints) {
    const section = sections.find((s) => s.template_section_id === sc.section_id);
    const name = section ? instanceById.get(section.instance_id)?.template_name : undefined;
    if (name && !checklistNaming.has(sc.checkpoint_id)) checklistNaming.set(sc.checkpoint_id, name);
  }
  const visits = input.checkIns.filter((c) => inWindow(c.timestamp, window));
  for (const c of visits) {
    const cp = c.checkpoint_id ? cpById.get(c.checkpoint_id) : undefined;
    const name = cp?.name ?? c.checkpoint_name ?? "";
    const manual = c.method === "manual";
    const outside = c.within_radius != null && !truthy(c.within_radius);
    const card = cardFor(cp?.location_id ?? null, name);
    const mark: Mark = manual || outside ? "exception" : "ok";
    push(card, {
      id: c.id,
      kind: "checkin",
      label: name,
      source: (c.checkpoint_id && checklistNaming.get(c.checkpoint_id)) || null,
      at: c.timestamp,
      result: manual
        ? { key: "manual", values: { reason: c.reason ?? "" } }
        : outside
          ? { key: "outsideRadius" }
          : { key: "scanned" },
      note: null,
      mark,
    });
    card.checkIns++;
    if (manual) {
      attention.push({ kind: "manualCheckin", tone: "warn", where: where(cp?.location_id) || name, at: c.timestamp, values: { checkpoint: name, reason: c.reason ?? "" } });
    } else if (outside) {
      attention.push({ kind: "outsideRadius", tone: "warn", where: where(cp?.location_id) || name, at: c.timestamp, values: { checkpoint: name } });
    }
  }

  // ---- incidents, tickets, notes
  const incidents: DocIncident[] = input.incidents
    .filter((i) => inWindow(i.created_at, window))
    .sort((a, b) => ms(a.created_at) - ms(b.created_at))
    .map((i) => ({
      id: i.id,
      title: i.title,
      typeName: i.type_name,
      targetLabel: i.target_label,
      createdAt: i.created_at,
      status: i.status_name,
      details: i.details,
      photos: [],
    }));
  for (const i of input.incidents.filter((x) => inWindow(x.created_at, window))) {
    attention.push({
      kind: "incident",
      tone: truthy(i.status_is_terminal) ? "warn" : "bad",
      where: i.target_label ?? "",
      at: i.created_at,
      values: { title: i.title },
    });
  }
  const tickets: DocTicket[] = input.tickets
    .filter((t) => inWindow(t.created_at, window))
    .sort((a, b) => ms(a.created_at) - ms(b.created_at))
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      targetLabel: t.target_label,
      createdAt: t.created_at,
      origin: t.origin,
      status: t.status_name,
      assignee: t.assignee_name,
      description: t.description,
      photos: [],
    }));
  const notes = input.notes
    .filter((n) => inWindow(n.created_at, window))
    .sort((a, b) => ms(a.created_at) - ms(b.created_at))
    .map((n) => ({ id: n.id, targetLabel: n.target_label, createdAt: n.created_at, body: n.body }));

  // ---- vehicles
  for (const v of input.vehicles) {
    if (v.end?.kind === "kept") {
      attention.push({ kind: "vehicleKept", tone: "bad", where: v.name, at: v.end.at, values: { vehicle: v.name, reason: v.keptReason ?? "" } });
    }
    for (const st of v.statuses) {
      if (st.name.replace(/\s+/g, "").toLowerCase() === "outofservice") {
        attention.push({ kind: "vehicleOutOfService", tone: "bad", where: v.name, at: st.at, values: { vehicle: v.name, note: st.note ?? "" } });
      }
    }
    if (v.note) {
      attention.push({ kind: "vehicleNote", tone: "warn", where: v.name, at: v.end?.at ?? null, values: { vehicle: v.name, note: v.note } });
    }
    if (v.fuelBack != null && v.fuelBack <= 1 && v.end?.kind === "in") {
      attention.push({ kind: "vehicleLowFuel", tone: "warn", where: v.name, at: v.end.at, values: { vehicle: v.name } });
    }
  }

  // ---- order
  attention.sort((a, b) => (a.at ? ms(a.at) : Infinity) - (b.at ? ms(b.at) : Infinity));
  // Worst first (missed, then exception, then all as expected), tree order
  // inside each group: a card with no location goes last; otherwise the
  // full path, which puts a parent before its children and siblings by name.
  const rank = { missed: 0, exception: 1, ok: 2 } as const;
  const locations = [...cards.values()]
    .map((c) => ({ ...c, items: [...c.items].sort((a, b) => (a.at ? ms(a.at) : Infinity) - (b.at ? ms(b.at) : Infinity)) }))
    .sort((a, b) => {
      const byTone = rank[worstMark(a.items)] - rank[worstMark(b.items)];
      if (byTone !== 0) return byTone;
      if (a.id === null || b.id === null) return a.id === null ? (b.id === null ? a.name.localeCompare(b.name) : 1) : -1;
      const pa = [...a.path, a.name];
      const pb = [...b.path, b.name];
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if (pa[i] === undefined) return -1;
        if (pb[i] === undefined) return 1;
        const c = pa[i].localeCompare(pb[i]);
        if (c !== 0) return c;
      }
      return 0;
    });

  const endedBy = input.shift.ended_at
    ? input.shift.end_of_shift_checklist_id
      ? { kind: "checklist" as const, name: input.instances.find((i) => i.id === input.shift.end_of_shift_checklist_id)?.template_name ?? "" }
      : { kind: "button" as const }
    : null;

  return {
    version: 1,
    marinaName: input.marinaName,
    shift: {
      id: input.shift.id,
      guardId: input.shift.guard_id,
      guardName: input.shift.guard_name ?? "",
      startedAt: input.shift.started_at,
      endedAt: input.shift.ended_at,
      endedBy,
    },
    note: input.note?.trim() ? input.note.trim() : null,
    checkIns: visits.length,
    checklists,
    attention,
    incidents,
    tickets,
    notes,
    vehicles: input.vehicles,
    locations,
  };
}

/** The worst mark in a card: what colours its edge. */
export function worstMark(items: RecordItem[]): Mark {
  if (items.some((i) => i.mark === "missed")) return "missed";
  if (items.some((i) => i.mark === "exception")) return "exception";
  return "ok";
}

/** The summary's sentences, as keys and values under reports:summary. */
export function summaryFacts(doc: ShiftReportDoc): Phrase[] {
  const first = doc.shift.guardName.split(" ")[0] || doc.shift.guardName;
  const complete = doc.checklists.filter((c) => c.done === c.total).length;
  const out: Phrase[] = [
    {
      key: "checkIns",
      values: {
        guard: first,
        checkIns: String(doc.checkIns),
        complete: String(complete),
        total: String(doc.checklists.length),
      },
    },
    { key: "raised", values: { incidents: String(doc.incidents.length), tickets: String(doc.tickets.length) } },
  ];
  for (const v of doc.vehicles) {
    if (v.distance == null || v.odometerOut == null) continue;
    const key = v.end?.kind === "kept" ? "droveKept" : v.end?.kind === "in" ? "droveReturned" : "droveStillOut";
    out.push({ key, values: { guard: first, vehicle: v.name, distance: String(v.distance), unit: v.meterType ?? "", fuel: v.fuelBack == null ? "" : String(v.fuelBack) } });
  }
  out.push({ key: "attention", values: { count: String(doc.attention.length) } });
  return out;
}

// ---- what moved since End of Shift (spec § The body is fixed)

export interface SinceRow {
  id: string;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  body: string | null;
  created_at: string;
  author_name: string | null;
}

export interface SinceInputs {
  incidentComments: { id: string; incident_id: string; body: string; created_at: string; author_name: string | null }[];
  incidentUpdates: { id: string; incident_id: string; kind: string; from_value: string | null; to_value: string | null; created_at: string; author_name: string | null }[];
  ticketUpdates: { id: string; ticket_id: string; kind: string; from_value: string | null; to_value: string | null; body: string | null; created_at: string; author_name: string | null }[];
}

export interface Since {
  rows: SinceRow[];
  /** The status now, when a status update moved it since End of Shift. */
  now: string | null;
}

export function updatesSince(doc: ShiftReportDoc, endedAt: string | null, input: SinceInputs): { incidents: Record<string, Since>; tickets: Record<string, Since> } {
  const after = (t: string) => endedAt != null && ms(t) > ms(endedAt);
  const incidents: Record<string, Since> = {};
  for (const i of doc.incidents) {
    const rows: SinceRow[] = [
      ...input.incidentComments.filter((c) => c.incident_id === i.id && after(c.created_at)).map((c) => ({ id: c.id, kind: "addendum", from_value: null, to_value: null, body: c.body, created_at: c.created_at, author_name: c.author_name })),
      ...input.incidentUpdates.filter((u) => u.incident_id === i.id && after(u.created_at)).map((u) => ({ id: u.id, kind: u.kind, from_value: u.from_value, to_value: u.to_value, body: null, created_at: u.created_at, author_name: u.author_name })),
    ].sort((a, b) => ms(a.created_at) - ms(b.created_at));
    const last = [...rows].reverse().find((r) => r.kind === "status");
    incidents[i.id] = { rows, now: last?.to_value ?? null };
  }
  const tickets: Record<string, Since> = {};
  for (const t of doc.tickets) {
    const rows = input.ticketUpdates
      .filter((u) => u.ticket_id === t.id && after(u.created_at) && u.kind !== "created")
      .map((u) => ({ id: u.id, kind: u.kind, from_value: u.from_value, to_value: u.to_value, body: u.body, created_at: u.created_at, author_name: u.author_name }))
      .sort((a, b) => ms(a.created_at) - ms(b.created_at));
    const last = [...rows].reverse().find((r) => r.kind === "status");
    tickets[t.id] = { rows, now: last?.to_value ?? null };
  }
  return { incidents, tickets };
}
