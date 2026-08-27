import { useQuery } from "@powersync/react";
import { stamp } from "../lib/db";
import { insert, transact, update } from "./sql";
import { recordActivity } from "./activity";
import {
  attachmentColumns,
  attachmentJoins,
  attachmentSelect,
  type AttachedRow,
  type AttachmentTarget,
} from "./attachments";

// Incidents — the one entity whose visibility is a hard gate.
//
// `view_incidents` is enforced three times over, and each layer catches what
// the others cannot: the nav hides the section, RLS refuses a direct read, and
// the sync stream never puts the row on the device in the first place. Only the
// last one holds in a dead zone, which is where a guard actually is.

export interface IncidentRow extends AttachedRow {
  id: string;
  title: string;
  incident_type_id: string | null;
  status_id: string;
  details: string | null;
  created_at: string;
  author_id: string | null;
  assigned_to_id: string | null;
  status_name: string;
  status_is_terminal: number;
  type_name: string | null;
  author_name: string | null;
  assignee_name: string | null;
}

const INCIDENT_SELECT = `
  SELECT i.*,
         s.name AS status_name,
         s.is_terminal AS status_is_terminal,
         ty.name AS type_name,
         au.name AS author_name,
         asg.name AS assignee_name,
         ${attachmentSelect("i")}
    FROM incidents i
    JOIN incident_statuses s ON s.id = i.status_id
    LEFT JOIN incident_types ty ON ty.id = i.incident_type_id
    LEFT JOIN users au ON au.id = i.author_id
    LEFT JOIN users asg ON asg.id = i.assigned_to_id
    ${attachmentJoins("i")}`;

export function useIncidents() {
  return useQuery<IncidentRow>(`${INCIDENT_SELECT} ORDER BY i.created_at DESC`);
}

export function useIncident(incidentId: string | undefined) {
  const { data, isLoading } = useQuery<IncidentRow>(
    `${INCIDENT_SELECT} WHERE i.id = ?`,
    [incidentId ?? ""],
  );
  return { incident: data[0] ?? null, isLoading };
}

export interface IncidentComment {
  id: string;
  incident_id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
}

export function useIncidentComments(incidentId: string | undefined) {
  return useQuery<IncidentComment>(
    `SELECT c.*, u.name AS author_name
       FROM incident_comments c
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.incident_id = ?
      ORDER BY c.created_at`,
    [incidentId ?? ""],
  );
}

export interface LinkedTicket {
  id: string;
  title: string;
  status_name: string;
}

export function useTicketsFromIncident(incidentId: string | undefined) {
  return useQuery<LinkedTicket>(
    `SELECT t.id, t.title, s.name AS status_name
       FROM tickets t
       JOIN ticket_statuses s ON s.id = t.status_id
      WHERE t.source_incident_id = ?
      ORDER BY t.created_at DESC`,
    [incidentId ?? ""],
  );
}

/**
 * Whether an incident's author may still edit the original text.
 *
 * The window is their own shift: open while the shift containing the
 * incident's creation is still running. An author with no shift records at all
 * — office staff who never clock in — is never locked out, because the
 * boundary simply does not exist for them.
 */
export function useCanEditOriginal(
  incident: IncidentRow | null,
  currentUserId: string | undefined,
): boolean {
  const isAuthor = Boolean(
    incident && currentUserId && incident.author_id === currentUserId,
  );
  const { data } = useQuery<{ total: number; containing: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN started_at <= ? AND ended_at IS NULL THEN 1 ELSE 0 END) AS containing
       FROM shifts WHERE guard_id = ?`,
    [incident?.created_at ?? "", incident?.author_id ?? ""],
  );
  const shifts = data[0];
  if (!isAuthor || !shifts) return false;
  return shifts.total === 0 || (shifts.containing ?? 0) > 0;
}

export interface NewIncident {
  title: string;
  details?: string;
  typeId?: string | null;
  statusId: string;
  assigneeId?: string | null;
  target: AttachmentTarget;
}

export async function createIncident(
  input: NewIncident,
  actorId: string | null,
): Promise<string> {
  return transact(async (tx) => {
    const incidentId = await insert(tx, "incidents", {
      title: input.title,
      details: input.details || null,
      incident_type_id: input.typeId || null,
      status_id: input.statusId,
      assigned_to_id: input.assigneeId || null,
      created_at: stamp(),
      author_id: actorId,
      ...attachmentColumns(input.target),
    });
    await recordActivity(tx, {
      eventType: "incident.created",
      summary: `Incident "${input.title}" logged on ${input.target.label}`,
      subjectType: "incidents",
      subjectId: incidentId,
      actorId,
    });
    return incidentId;
  });
}

export async function setIncidentStatus(
  incident: { id: string; title: string },
  status: { id: string; name: string },
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "incidents", incident.id, { status_id: status.id });
    await recordActivity(tx, {
      eventType: "incident.status_changed",
      summary: `"${incident.title}" set to ${status.name}`,
      subjectType: "incidents",
      subjectId: incident.id,
      actorId,
    });
  });
}

export async function assignIncident(
  incident: { id: string; title: string },
  assignee: { id: string; name: string },
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "incidents", incident.id, { assigned_to_id: assignee.id });
    await recordActivity(tx, {
      eventType: "incident.assigned",
      summary: `"${incident.title}" assigned to ${assignee.name}`,
      subjectType: "incidents",
      subjectId: incident.id,
      actorId,
    });
  });
}

/** An addendum. Append-only by design: nothing edits or removes one. */
export async function addIncidentComment(
  incident: { id: string; title: string },
  body: string,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await insert(tx, "incident_comments", {
      incident_id: incident.id,
      body,
      created_at: stamp(),
      author_id: actorId,
    });
    await recordActivity(tx, {
      eventType: "incident.commented",
      summary: `Addendum added to "${incident.title}"`,
      subjectType: "incidents",
      subjectId: incident.id,
      actorId,
    });
  });
}

export async function editIncidentOriginal(
  incidentId: string,
  title: string,
  details: string,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "incidents", incidentId, {
      title,
      details: details || null,
    });
    await recordActivity(tx, {
      eventType: "incident.edited",
      summary: `"${title}" edited by its author`,
      subjectType: "incidents",
      subjectId: incidentId,
      actorId,
    });
  });
}
