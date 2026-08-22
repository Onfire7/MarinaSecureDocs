// Activity Log — write-time generation (see docs/architecture.md —
// Activity Log generation, pages/activity-log.html).
//
// Entries are generated immutably by the same code paths that make the
// underlying change, never reconstructed later. Two documented exceptions:
// the Activity Log never logs its own writes, and high-frequency/low-value
// changes are excluded at write time rather than filtered out of the feed.
import { db, id } from "./db";
import type { Permission } from "./permissions";

/** Entity namespaces an entry can be about. */
export type SubjectType =
  | "checklistInstances"
  | "checkIns"
  | "tickets"
  | "incidents"
  | "reservations"
  | "locations"
  | "boats"
  | "vehicles"
  | "assets"
  | "contacts"
  | "leases"
  | "notes"
  | "shifts"
  | "users"
  | "roles"
  | "calls"
  | "smsThreads";

/**
 * Per-entry visibility: an entry is shown only if its subject's own
 * governing permission is held. Subjects absent from this map are
 * unrestricted (tickets, locations, reservations, boats, assets, notes …),
 * matching how those entities are treated everywhere else.
 */
const SUBJECT_PERMISSION: Partial<Record<SubjectType, Permission>> = {
  incidents: "view_incidents",
  contacts: "view_owner",
  leases: "view_lease",
  calls: "view_calls",
  smsThreads: "view_sms",
  users: "manage_users",
  roles: "manage_roles",
};

export function subjectPermission(subjectType: string): Permission | undefined {
  return SUBJECT_PERMISSION[subjectType as SubjectType];
}

/** Route to a subject's own detail page, or null when it has none. */
export function subjectPath(subjectType: string, subjectId: string): string | null {
  switch (subjectType as SubjectType) {
    case "checklistInstances":
      return `/checklists/${subjectId}`;
    case "tickets":
      return `/tickets/${subjectId}`;
    case "incidents":
      return `/incidents/${subjectId}`;
    case "reservations":
      return `/reservations/${subjectId}`;
    case "locations":
      return `/locations/${subjectId}`;
    case "boats":
      return `/boats/${subjectId}`;
    case "vehicles":
      return `/vehicles/${subjectId}`;
    case "assets":
      return `/assets/${subjectId}`;
    case "contacts":
      return `/contacts/${subjectId}`;
    case "leases":
      return `/contacts/leases/${subjectId}`;
    default:
      // Check-ins, notes, shifts, users, roles, calls and SMS threads have no
      // standalone detail route of their own.
      return null;
  }
}

export const SUBJECT_LABEL: Record<SubjectType, string> = {
  checklistInstances: "Checklist",
  checkIns: "Check-in",
  tickets: "Ticket",
  incidents: "Incident",
  reservations: "Reservation",
  locations: "Location",
  boats: "Boat",
  vehicles: "Vehicle",
  assets: "Asset",
  contacts: "Contact",
  leases: "Lease",
  notes: "Note",
  shifts: "Shift",
  users: "User",
  roles: "Role",
  calls: "Call",
  smsThreads: "SMS thread",
};

export interface ActivityInput {
  /** Dotted event name, e.g. "ticket.created". */
  eventType: string;
  /** Human-readable, generated at write time — never recomputed for display. */
  summary: string;
  subjectType: SubjectType;
  subjectId: string;
  /** Omit for system-generated events; the feed shows those as "System". */
  actorId?: string | null;
}

/**
 * A transaction chunk recording one activity entry. Append to the same
 * db.transact([...]) as the change it describes, so the entry and the change
 * land together.
 */
export function activityTx(input: ActivityInput) {
  const tx = db.tx.activityLogEntries[id()].update({
    eventType: input.eventType,
    summary: input.summary,
    timestamp: Date.now(),
    protected: false,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });
  return input.actorId ? tx.link({ actor: input.actorId }) : tx;
}

/** Fire-and-forget for call sites that aren't already inside a transact. */
export function logActivity(input: ActivityInput): void {
  void db.transact(activityTx(input)).catch(console.error);
}
