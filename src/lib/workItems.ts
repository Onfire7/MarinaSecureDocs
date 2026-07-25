// Tickets & Incidents — shared display constants (see pages/ticket-queue.html,
// pages/incident-list.html).

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

export function incidentStatusBadgeClass(status: string): string {
  switch (status) {
    case "open":
      return "badge badge-bad";
    case "under_review":
      return "badge badge-warn";
    case "resolved":
      return "badge badge-good";
    default:
      return "badge";
  }
}
