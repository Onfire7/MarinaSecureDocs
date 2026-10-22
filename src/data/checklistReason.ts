import { dataT } from "../i18n";

// Why a checklist was created, as recorded in its Activity Log line.
//
// Structured rather than a string the caller words: the line is stored in
// the marina's language (records:checklistCreated), and a translation needs
// the whole sentence, not "created by" plus an English fragment. Pure, so the
// wording is unit-tested without the database.

export type InstanceReason =
  | { kind: "clockIn" }
  | { kind: "clockOut" }
  | { kind: "schedule" }
  /** Started by hand; `name` is who, when the device knows. */
  | { kind: "manual"; name: string | null }
  /** A location check item on another checklist; `label` is that item's. */
  | { kind: "locationCheck"; label: string };

export function checklistCreatedSummary(template: string, reason: InstanceReason): string {
  const ns = "records";
  switch (reason.kind) {
    case "manual":
      return reason.name
        ? dataT("checklistCreated.manual", { ns, template, name: reason.name })
        : dataT("checklistCreated.manualUnknown", { ns, template });
    case "locationCheck":
      return dataT("checklistCreated.locationCheck", { ns, template, label: reason.label });
    default:
      return dataT(`checklistCreated.${reason.kind}`, { ns, template });
  }
}
