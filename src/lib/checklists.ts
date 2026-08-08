// Checklists — shared shapes for the opaque json fields on
// ChecklistTemplateItem.config / ChecklistInstanceItem.result (typed here
// rather than in the schema since InstantDB's json columns are untyped
// storage), plus the rule-resolution helpers that turn a template's authored
// rules (hideUntilRule, dueBy, recurrence) into concrete instance timestamps.
// Trigger rules decide IF a row is created; hideUntil decides WHEN it shows.
import { rrulestr } from "rrule";

export type ItemType =
  | "simple_check"
  | "verify_task"
  | "door_check"
  | "lock_check"
  | "location_check"
  | "meter_reading"
  | "question";

/** One-line reading of a recorded answer, for lists and reports. */
export function questionAnswerSummary(r: QuestionResult): string {
  switch (r.answerType) {
    case "yes_no":
      return (r.yes ? "Yes" : "No") + (r.details ? ` — ${r.details}` : "");
    case "number":
      return r.value == null ? "—" : String(r.value);
    case "repeatable_line": {
      const lines = (r.lines ?? []).filter((l) => l.trim());
      return lines.length ? lines.join("; ") : "—";
    }
    default:
      return r.text?.trim() ? r.text.trim() : "—";
  }
}

/**
 * Item types that record a physical thing's state as found and as left.
 * A Lock Check is the same check as a door with a shorter vocabulary — a
 * padlocked gate, a fuel pump, a shed hasp has no "open" state, only locked
 * or unlocked — so the two share one implementation parameterised by the
 * states they allow.
 */
export type StateCheckType = "door_check" | "lock_check";

/**
 * Lock Check shipped briefly as "gas_pump_check" before it was generalised
 * past fuel pumps. Rows written in that window keep the old string, so it's
 * mapped rather than migrated — the type is opaque storage, and a rename
 * shouldn't strand anyone's template.
 */
const LEGACY_ITEM_TYPES: Record<string, ItemType> = {
  gas_pump_check: "lock_check",
};

export function normalizeItemType(type: string): string {
  return LEGACY_ITEM_TYPES[type] ?? type;
}

export const STATE_CHECK_KINDS: Record<
  StateCheckType,
  { label: string; noun: string; states: DoorState[]; defaultState: DoorState }
> = {
  door_check: {
    label: "Door Check",
    noun: "door",
    states: ["open", "unlocked", "locked"],
    defaultState: "locked",
  },
  lock_check: {
    label: "Lock Check",
    noun: "lock",
    states: ["unlocked", "locked"],
    defaultState: "locked",
  },
};

export function isStateCheck(type: string): type is StateCheckType {
  const t = normalizeItemType(type);
  return t === "door_check" || t === "lock_check";
}

// "Closed" isn't its own state — a door that's locked or unlocked is
// necessarily closed, so those two states already imply it.
export type DoorState = "open" | "unlocked" | "locked";

// ---- ChecklistTemplateItem.config, per type ----

export interface VerifyTaskConfig {
  requireAttemptBeforeReject?: boolean;
}
export interface DoorCheckConfig {
  /**
   * The state it should be FOUND in. Absent means there is no found-state
   * expectation — the guard is never asked how they found it and no
   * found-state incident can arise. That's the right answer for anything
   * with no single legitimate resting state (a door unlocked by day and
   * locked overnight), and it's what every item carried into this shape has,
   * since the old config couldn't express a found state distinct from a
   * left state.
   */
  expectedState?: DoorState;
  /**
   * The state it should be LEFT in. Required going forward; absent only on
   * rows written before the two states were separated, where `expectedState`
   * held the single value that served as both — see the legacy fallback in
   * checklistItems.tsx, which is what keeps those rows behaving as authored.
   */
  finalState?: DoorState;
  /**
   * The Location this door or pump belongs to — required, and what a mismatch
   * incident attaches to. A door isn't an entity of its own (it's a labelled
   * item on a template), so without this there is nothing to attach to.
   * Defaulted from the template's checkpoint when the item is created, and
   * flagged in the template builder when missing. Still optional in the type
   * because items authored before it existed have none.
   */
  locationId?: string;
  /**
   * The Asset this check belongs to, where the thing being checked is one —
   * a padlocked gate or a shed hasp that the marina already tracks. Either
   * this or `locationId` is enough to give an incident something to attach
   * to; both is fine, and neither is what the builder warns about.
   */
  assetId?: string;
  /**
   * @deprecated Superseded by an absent `expectedState`, which says the same
   * thing without a second field that can disagree with the first. Still read
   * on rows written before the split.
   */
  finalStateOnly?: boolean;
}
export interface LocationCheckConfig {
  locationId: string;
  templateId: string;
}
export interface QuestionConfig {
  /** Absent reads as a single line — the plainest answer a question can take. */
  answerType?: QuestionAnswerType;
  /**
   * Yes/No only: which answer opens a details box. A question where only one
   * of the answers needs explaining ("Anything to report?") shouldn't ask
   * twice, so this is per-answer rather than a single "ask for details" flag.
   */
  detailsOn?: YesNoDetailsOn;
  /** Number only: how much the minus and plus buttons move the value. */
  step?: number;
}
export interface MeterReadingConfig {
  /** Fixed by the template; absent means the guard selects an asset at runtime. */
  assetId?: string;
}

// ---- Deferred side effects ----

/**
 * Incidents, tickets and meter readings raised by a checklist item are
 * *described* while the guard works and only *written* when the checklist is
 * submitted. Until then an item can be edited or redone freely, which would
 * otherwise mean deleting real Incidents and Tickets, un-bumping an Asset's
 * meter, and retracting auto-generated maintenance work — none of which the
 * app can do safely.
 *
 * `openedAt` is captured when the guard actually recorded the finding, not
 * when submit happens, so a door found open at 02:10 and submitted at 05:45
 * reports as having been found open at 02:10.
 *
 * The ids are minted up front so a result can reference its own effects
 * before those rows exist, and so re-submitting can't duplicate them.
 */
export interface PendingIncident {
  id: string;
  title: string;
  details?: string;
  openedAt: number;
  /** Attachment target; absent means the item had no location bound. */
  target?: { type: string; id: string; label: string };
}
export interface PendingTicket {
  id: string;
  title: string;
  description?: string;
  openedAt: number;
  priority: string;
  autoGenerated: boolean;
  /** Links the ticket back to the incident raised by the same item. */
  sourceIncidentId?: string;
  assetId?: string;
}
export interface PendingMeterReading {
  id: string;
  assetId: string;
  value: number;
  openedAt: number;
  correctionReason?: string;
}

// ---- ChecklistItemResult.result, per type ----

export interface SimpleCheckResult {
  type: "simple_check";
  completedAt: number;
}
export interface VerifyTaskResult {
  type: "verify_task";
  outcome: "confirmed" | "rejected_reason" | "rejected_ticket";
  reason?: string;
  attempted?: boolean;
  pendingTicket?: PendingTicket;
}
export interface DoorCheckAttempt {
  observed: DoorState;
  matched: boolean;
}
/**
 * Records the door's state *as found* and *as left*, separately — the whole
 * point of a door check for reporting. "Locked when I left" says nothing
 * about whether it was standing open when the guard walked up, and only the
 * pair together answers both "was this door secure overnight?" and "did the
 * guard fix it?".
 *
 * initialState/finalState are optional only because rows written before this
 * change carry the older attempts/resolution shape instead. Read either via
 * doorCheckSummary() rather than branching on shape at each call site.
 */
export interface DoorCheckResult {
  type: StateCheckType;
  expected: DoorState;
  initialState?: DoorState;
  finalState?: DoorState;
  note?: string;
  /** Incident raised because the door was found in the wrong state. */
  pendingIncident?: PendingIncident;
  /** Raised when the door was left in a state that still isn't expected. */
  pendingTicket?: PendingTicket;
  /** Set once the deferred effects were actually written, at submit. */
  incidentId?: string;
  /** @deprecated pre-initial/final shape; still present on historical rows. */
  attempts?: DoorCheckAttempt[];
  /** @deprecated pre-initial/final shape; still present on historical rows. */
  resolution?: "matched" | "note" | "ticket";
}
export interface LocationCheckResult {
  type: "location_check";
  nestedChecklistId: string;
}
export interface MeterReadingResult {
  type: "meter_reading";
  assetId: string;
  value: number;
  meterReadingId: string;
  /**
   * The reading itself is deferred too, not just the tickets it triggers:
   * writing it early would bump Asset.meter_reading off a number the guard
   * can still correct, and maintenance rules must be evaluated against the
   * value actually submitted.
   */
  pendingReading?: PendingMeterReading;
}

export interface QuestionResult {
  type: "question";
  /** Copied from the config at answer time, so a later edit to the template
      can't change how a recorded answer is read back. */
  answerType: QuestionAnswerType;
  /** single_line and multi_line. */
  text?: string;
  /** repeatable_line — one entry per box, in the order they were added. */
  lines?: string[];
  /** number */
  value?: number;
  /** yes_no */
  yes?: boolean;
  /** yes_no, when that answer was configured to ask. */
  details?: string;
}

export type ItemResult =
  | SimpleCheckResult
  | VerifyTaskResult
  | DoorCheckResult
  | LocationCheckResult
  | MeterReadingResult
  | QuestionResult;

// ---- Template trigger types ----

// How an instance came to exist is not stored on it — the parent template's
// triggerType says how instances of it get created (provenance details go to
// the activity log at creation). Nested location_check sub-checklists are the
// exception, marked by their parentItem link.
export type TemplateTriggerType =
  | "manual"
  | "clock_in"
  | "clock_out"
  | "checkpoint"
  | "recurring";

export const TEMPLATE_TRIGGER_LABEL: Record<TemplateTriggerType, string> = {
  manual: "Manual",
  clock_in: "Clock In",
  clock_out: "Clock Out",
  checkpoint: "Checkpoint",
  recurring: "Recurring",
};

export function triggerTypeLabel(t: string | null | undefined): string {
  return TEMPLATE_TRIGGER_LABEL[t as TemplateTriggerType] ?? "—";
}

export function doorStateLabel(s: DoorState): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One reading of a door check across both stored shapes. Historical rows
 * only ever recorded the *last* observed state, so their "as found" value is
 * unknowable — foundKnown says so explicitly rather than quietly implying
 * the door was found correct.
 */
export function doorCheckSummary(r: DoorCheckResult): {
  expected: DoorState;
  initial: DoorState | null;
  final: DoorState | null;
  foundKnown: boolean;
  foundAsExpected: boolean;
  leftAsExpected: boolean;
  corrected: boolean;
  note?: string;
  incidentId?: string;
} {
  const legacyLast = r.attempts?.at(-1)?.observed ?? null;
  const initial = r.initialState ?? null;
  const final = r.finalState ?? legacyLast;
  const foundKnown = r.initialState != null;
  const foundAsExpected = foundKnown && initial === r.expected;
  const leftAsExpected = final != null && final === r.expected;
  return {
    expected: r.expected,
    initial,
    final,
    foundKnown,
    foundAsExpected,
    leftAsExpected,
    corrected: foundKnown && !foundAsExpected && leftAsExpected,
    note: r.note,
    incidentId: r.incidentId,
  };
}

/** Display label for an item type, mapping legacy type strings first. */
export function itemTypeLabel(type: string): string {
  const t = normalizeItemType(type);
  return ITEM_TYPE_LABEL[t as ItemType] ?? type;
}

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  simple_check: "Simple Check",
  verify_task: "Verify Task",
  door_check: "Door Check",
  lock_check: "Lock Check",
  location_check: "Location-Based Check",
  meter_reading: "Meter Reading",
  question: "Question",
};

/**
 * How a Question takes its answer. The shape of the answer is the whole
 * configuration of the type — everything else about a question is its label.
 */
export type QuestionAnswerType =
  | "single_line"
  | "repeatable_line"
  | "multi_line"
  | "number"
  | "yes_no";

export const QUESTION_ANSWER_LABEL: Record<QuestionAnswerType, string> = {
  single_line: "Single line",
  repeatable_line: "Repeatable lines",
  multi_line: "Multi-line",
  number: "Number",
  yes_no: "Yes / No",
};

/** Which Yes/No answers ask for details as well. */
export type YesNoDetailsOn = "none" | "yes" | "no" | "both";

export const YES_NO_DETAILS_LABEL: Record<YesNoDetailsOn, string> = {
  none: "Never",
  yes: "On Yes",
  no: "On No",
  both: "On either",
};

// ---- Section trigger types ----

// manual and recurring sections are created with their instance; checkpoint,
// location and asset sections are created lazily onto an already-open
// instance when that thing is actually visited. Nothing here is about
// time-of-day — that's hideUntilRule's job.
export type SectionTriggerType =
  | "manual"
  | "recurring"
  | "checkpoint"
  | "location"
  | "asset";

export interface TriggerConfig {
  /**
   * For "recurring" (sections and templates alike): an RFC 5545 RRULE naming
   * which *days* apply — e.g. "FREQ=WEEKLY;BYDAY=TU" for Tuesdays. Purely a
   * calendar-day gate on creation; any time-of-day component is ignored.
   */
  recurrenceRule?: string;
}

/** The parts of a ChecklistTemplateItem every consumer here relies on. */
export interface TemplateItemLike {
  id: string;
  type: string;
  label: string;
  order: number;
  config?: Record<string, unknown>;
}

// ---- Rule resolution (template rules → instance timestamps) ----

export type DueByRule =
  | { kind: "time"; time: string }
  | { kind: "offset"; minutes: number };

/** Next occurrence of a local "HH:MM" strictly after `from`; null if malformed. */
function nextOccurrenceOf(time: string, from: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const at = new Date(from);
  at.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * Resolve an authored hideUntilRule ("HH:MM") to a concrete timestamp at
 * instantiation, or null for visible-immediately. Malformed rules resolve to
 * visible — an admin typo must never hide assigned work.
 *
 * The rule is simply the next occurrence of that clock time: a checklist is
 * assumed to be created before any hide-until inside it. That assumption is
 * what makes a clock time mean anything at all here — the alternative is
 * asking whether "19:00" meant tonight's or yesterday's, which cannot be
 * answered from the creation time, and can't be answered from the shift
 * either, since plenty of people who run checklists never clock into one.
 *
 * A guess used to live here: reveals more than 20 hours out were read as
 * "that time already passed today". It was wrong in both directions — five
 * hours ahead is a genuine reveal for a day shift and a stale one for a night
 * shift that began at 4am — and no threshold can tell those apart. Where the
 * assumption doesn't hold, the template builder says so at authoring time
 * (see HIDE_UNTIL_TRIGGER_WARNING), which is the only place the question can
 * actually be settled.
 */
export function resolveHideUntil(
  rule: string | null | undefined,
  createdAt: Date = new Date(),
): number | null {
  if (!rule?.trim()) return null;
  return nextOccurrenceOf(rule, createdAt)?.getTime() ?? null;
}

/**
 * Warns where "created before its own hide-until" can quietly stop being
 * true. The author is warned rather than blocked: a late start is unusual,
 * not impossible, and the rule is still what they meant on every ordinary
 * day.
 *
 * The same trigger name means different things at the two levels, so they
 * can't share one list. A *section* triggered "manual" is created with its
 * checklist, and inherits whatever the template's trigger decided — nothing
 * arbitrary about it. A *template* triggered "manual" is created the moment
 * somebody taps Start, which is as arbitrary as it gets.
 */
export function hideUntilWarning(
  level: "template" | "section",
  triggerType: string,
): string | undefined {
  if (level === "template") {
    if (triggerType === "manual")
      return "Manual checklists start whenever someone taps Start, so one begun after this time hides the row until the same time tomorrow.";
    if (triggerType === "checkpoint")
      return "Checkpoint scans happen at any hour, so a scan after this time hides the row until the same time tomorrow.";
    if (triggerType === "clock_out")
      return "Clock-out checklists are created as someone leaves, so anything hidden until later the same day won't be seen on that shift at all.";
    return undefined;
  }
  // Sections created lazily onto an already-open checklist, whenever the
  // place they belong to is actually visited.
  if (triggerType === "checkpoint")
    return "Checkpoint sections appear when the checkpoint is scanned, which can be any hour — a scan after this time hides the section until the same time tomorrow.";
  if (triggerType === "location")
    return "Location sections appear when the location is visited, which can be any hour — a visit after this time hides the section until the same time tomorrow.";
  if (triggerType === "asset")
    return "Asset sections appear when the asset is scanned, which can be any hour — a scan after this time hides the section until the same time tomorrow.";
  return undefined;
}

/**
 * Resolve a dueBy rule to a concrete timestamp at instantiation. "time" is
 * the plain next occurrence — a due time always rolls forward (due 05:00,
 * created 17:00 → 5am tomorrow), unlike hide-until there is no ambiguity.
 */
export function resolveDueBy(
  rule: DueByRule | null | undefined,
  createdAt: Date = new Date(),
): number | null {
  if (!rule) return null;
  if (rule.kind === "offset") {
    if (!Number.isFinite(rule.minutes) || rule.minutes <= 0) return null;
    return createdAt.getTime() + rule.minutes * 60_000;
  }
  return nextOccurrenceOf(rule.time, createdAt)?.getTime() ?? null;
}

/**
 * Whether a recurrence rule has an occurrence on `day`'s local calendar day.
 * No rule = applies every day. Malformed rules apply — a typo should create
 * an extra checklist, not silently drop scheduled work.
 */
export function recurrenceMatchesDay(
  rule: string | null | undefined,
  day: Date = new Date(),
): boolean {
  if (!rule?.trim()) return true;
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  try {
    // dtstart must precede the day being tested or the rule generates
    // nothing there; a year back covers YEARLY at negligible expansion cost.
    const dtstart = new Date(dayStart.getTime() - 366 * 24 * 60 * 60_000);
    const parsed = rrulestr(rule, { dtstart });
    return parsed.between(dayStart, dayEnd, true).length > 0;
  } catch (error) {
    console.error("Invalid recurrence rule:", rule, error);
    return true;
  }
}

/**
 * Creation-day eligibility shared by templates and sections: any row with a
 * recurrence rule gates on it — for "recurring" it's the whole trigger, but
 * a checkpoint-triggered template can also carry one ("only on Tuesdays").
 * No rule means eligible whenever the creating event happens.
 */
export function eligibleToday(
  row: { triggerType: string; triggerConfig?: Record<string, unknown> | null },
  day: Date = new Date(),
): boolean {
  return recurrenceMatchesDay((row.triggerConfig as TriggerConfig | null)?.recurrenceRule, day);
}

// ---- Instance visibility & derived completion ----

/**
 * hideUntil filter for instances and instance sections. Timestamps arrive as
 * number or ISO string depending on how the row was written; normalize here.
 * Once now passes hideUntil the row is permanently visible — nothing re-hides.
 */
export function isVisibleNow(
  row: { hideUntil?: number | string | null },
  now: number = Date.now(),
): boolean {
  if (row.hideUntil == null) return true;
  return now >= new Date(row.hideUntil).getTime();
}

/**
 * When a section finished: the latest of its items' completedAt, and only
 * once every item has one. Derived at read time — storing it would mean an
 * extra write on every item completion just to keep a summary in sync.
 */
export function sectionCompletionTime(
  items: { completedAt?: number | string | null }[],
): number | null {
  if (items.length === 0) return null;
  let latest = 0;
  for (const it of items) {
    if (it.completedAt == null) return null;
    latest = Math.max(latest, new Date(it.completedAt).getTime());
  }
  return latest;
}
