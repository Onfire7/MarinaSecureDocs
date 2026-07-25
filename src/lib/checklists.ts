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

export type DoorState = "open" | "closed" | "locked" | "unlocked";

// ---- ChecklistTemplateItem.config, per type ----

export interface VerifyTaskConfig {
  requireAttemptBeforeReject?: boolean;
}
export interface DoorCheckConfig {
  expectedState: DoorState;
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
export interface DoorCheckResult {
  type: "door_check";
  expected: DoorState;
  attempts: DoorCheckAttempt[];
  resolution: "matched" | "note" | "ticket";
  note?: string;
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
