// Tickets & Incidents — shared display constants (see pages/ticket-queue.html,
// pages/incident-list.html).
//
// Priority is still an enum, so its values are literal. An incident's STATUS
// is not: it is a row a marina names, so the colour is chosen off a normalised
// key and anything a marina invents falls through to the neutral badge.
import { statusKey } from "./locations";

export const PRIORITY_ORDER = ["urgent", "high", "medium", "low"] as const;

export function priorityBadgeClass(priority: string): string {
  switch (priority) {
    case "urgent":
      return "badge badge-bad";
    case "high":
      return "badge badge-warn";
    default:
      return "badge";
  }
}

export function incidentStatusBadgeClass(status: string | null | undefined): string {
  switch (statusKey(status)) {
    case "open":
      return "badge badge-bad";
    case "under_review":
      return "badge badge-warn";
    case "resolved":
    case "closed":
      return "badge badge-good";
    default:
      return "badge";
  }
}
