// Checklists & Tours — shared shapes for the opaque json fields on
// ChecklistTemplateItem.config / ChecklistItemResult.result / Checklist.triggeredBy
// (see instant.schema.ts — these are typed here rather than in the schema
// itself since InstantDB's json columns are untyped storage).
import type { InstaQLEntity } from "@instantdb/react";
import type { AppSchema } from "./db";

export type ItemType =
  | "simple_check"
  | "verify_task"
  | "door_check"
  | "location_check"
  | "meter_reading";

// "Closed" isn't its own state — a door that's locked or unlocked is
// necessarily closed, so those two states already imply it.
export type DoorState = "open" | "unlocked" | "locked";

// ---- ChecklistTemplateItem.config, per type ----

export interface VerifyTaskConfig {
  requireAttemptBeforeReject?: boolean;
}
export interface DoorCheckConfig {
  expectedState: DoorState;
  /**
   * The Location this door belongs to. A door isn't an entity of its own —
   * it's a labelled item on a template — so this is what a mismatch incident
   * attaches to. Optional because items authored before this existed have no
   * binding; those fall back to asking the guard to pick a target.
   */
  locationId?: string;
}
export interface LocationCheckConfig {
  locationId: string;
  templateId: string;
}
export interface MeterReadingConfig {
  /** Fixed by the template; absent means the guard selects an asset at runtime. */
  assetId?: string;
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
  type: "door_check";
  expected: DoorState;
  initialState?: DoorState;
  finalState?: DoorState;
  note?: string;
  /** Incident logged because the door was found in the wrong state. */
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
}

export type ItemResult =
  | SimpleCheckResult
  | VerifyTaskResult
  | DoorCheckResult
  | LocationCheckResult
  | MeterReadingResult;

// ---- Checklist.triggeredBy ----

export type TriggeredBy =
  | { type: "clock_in" | "clock_out"; shiftId: string }
  | { type: "checkpoint"; checkpointId: string; checkInId: string }
  | { type: "scheduled" }
  | { type: "manual" }
  | { type: "incident_type"; incidentId: string }
  | { type: "location_check"; parentChecklistId: string; locationId: string };

export function triggeredByLabel(
  t: TriggeredBy | null | undefined,
  checkpointName?: string,
): string {
  if (!t) return "Manually started";
  switch (t.type) {
    case "clock_in":
      return "Clock In";
    case "clock_out":
      return "Clock Out";
    case "checkpoint":
      return `Checkpoint: ${checkpointName ?? "—"}`;
    case "scheduled":
      return "Scheduled";
    case "manual":
      return "Manual";
    case "incident_type":
      return "Incident";
    case "location_check":
      return "Location-Based Check";
    default:
      return "—";
  }
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

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  simple_check: "Simple Check",
  verify_task: "Verify Task",
  door_check: "Door Check",
  location_check: "Location-Based Check",
  meter_reading: "Meter Reading",
};

type ChecklistTemplate = InstaQLEntity<AppSchema, "checklistTemplates">;

// Checkpoint-triggered templates carry an optional time-of-day window in
// triggerConfig; every other trigger type (or one with no window configured)
// always applies. Season-based conditions are not modeled yet.
export function templateAppliesNow(
  template: Pick<ChecklistTemplate, "triggerType" | "triggerConfig">,
  now: Date = new Date(),
): boolean {
  if (template.triggerType !== "checkpoint") return true;
  const cfg = (template.triggerConfig ?? {}) as {
    timeStart?: string;
    timeEnd?: string;
  };
  if (!cfg.timeStart || !cfg.timeEnd) return true;
  const [sh, sm] = cfg.timeStart.split(":").map(Number);
  const [eh, em] = cfg.timeEnd.split(":").map(Number);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}
