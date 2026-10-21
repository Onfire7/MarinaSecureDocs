import { useQuery } from "@powersync/react";
import { useMemo } from "react";
import { stamp } from "../lib/db";
import { insert, transact, update } from "./sql";
import { recordActivity } from "./activity";
import { attachmentJoins, attachmentOf, attachmentSelect, type AttachedRow } from "./attachments";
import { useCheckInsInWindow } from "./checkins";
import { useCheckpoints } from "./checkpoints";
import { useLocations } from "./locations";
import { useIncidents } from "./incidents";
import { useTickets } from "./tickets";
import { useMarinaSettings } from "./settings";
import { useShiftVehicleRecords } from "./fleet";
import type { ShiftRow } from "./shifts";
import { compileVehicleUse, shiftWindowMs } from "../lib/shiftReport";
import type { CompileInputs, ShiftReportDoc, SinceInputs } from "../lib/shiftReportDoc";

// What the Shift Report is compiled from, gathered from the device
// (ShiftReportPage.spec.md § The body is fixed at End of Shift). The compiler
// is src/lib/shiftReportDoc.ts; this only reads rows. Query arguments come
// from the shift's stored times, never from "now": an argument that moves
// every render resubscribes forever (CLAUDE.md § Learnings).

interface InstanceLite {
  id: string;
  template_name: string | null;
  status: string;
  created_at: string | null;
  completed_at: string | null;
  due_by: string | null;
}
interface SectionLite {
  id: string;
  instance_id: string;
  template_section_id: string | null;
  label: string;
  location_id: string | null;
  due_by: string | null;
}
interface ItemLite {
  id: string;
  section_id: string;
  type: string;
  label: string;
  completed_at: string | null;
  result: string | null;
  note: string | null;
}
interface NoteLite extends AttachedRow {
  id: string;
  body: string;
  created_at: string;
}

const GUARD_INSTANCES = `
  SELECT id FROM checklist_instances
   WHERE assigned_to_id = ? AND parent_item_id IS NULL
     AND (created_at >= ? OR status <> 'complete' OR completed_at >= ?)`;

export function useShiftReportInputs(shift: ShiftRow | null, note: string | null = null): CompileInputs | null {
  const guard = shift?.guard_id ?? "";
  const from = shift ? new Date(shift.started_at).toISOString() : "9999";
  const to = !shift ? "0000" : shift.ended_at ? new Date(Date.parse(shift.ended_at) + 60_000).toISOString() : "9999";
  // A checklist carried in from the previous shift was created before the
  // window; reach back two days for it, and let the compiler decide.
  const back = shift ? new Date(Date.parse(shift.started_at) - 2 * 86_400_000).toISOString() : "9999";

  const settings = useMarinaSettings();
  const { data: checkIns } = useCheckInsInWindow(guard || undefined, from, to);
  const { data: checkpoints } = useCheckpoints();
  const { data: locations } = useLocations();
  const { data: instances } = useQuery<InstanceLite>(
    `SELECT i.id, t.name AS template_name, i.status, i.created_at, i.completed_at, i.due_by
       FROM checklist_instances i LEFT JOIN checklist_templates t ON t.id = i.template_id
      WHERE i.id IN (${GUARD_INSTANCES})`,
    [guard, back, from],
  );
  const { data: sections } = useQuery<SectionLite>(
    `SELECT s.id, s.instance_id, s.template_section_id, s.label, s.location_id, s.due_by
       FROM checklist_instance_sections s
      WHERE s.instance_id IN (${GUARD_INSTANCES})`,
    [guard, back, from],
  );
  const { data: items } = useQuery<ItemLite>(
    `SELECT ii.id, ii.section_id, ti.type, ti.label, ii.completed_at, ii.result, ii.note
       FROM checklist_instance_items ii
       JOIN checklist_instance_sections s ON s.id = ii.section_id
       LEFT JOIN checklist_template_items ti ON ti.id = ii.template_item_id
      WHERE s.instance_id IN (${GUARD_INSTANCES})`,
    [guard, back, from],
  );
  const { data: sectionCheckpoints } = useQuery<{ section_id: string; checkpoint_id: string }>(
    "SELECT section_id, checkpoint_id FROM template_section_checkpoints",
  );
  const { data: allIncidents } = useIncidents();
  const { data: allTickets } = useTickets();
  const { data: origins } = useQuery<{ ticket_id: string; to_value: string | null }>(
    "SELECT ticket_id, to_value FROM ticket_updates WHERE kind = 'created' AND author_id = ?",
    [guard],
  );
  const { data: notes } = useQuery<NoteLite>(
    `SELECT n.id, n.body, n.created_at, ${attachmentSelect("n")}
       FROM notes n ${attachmentJoins("n")}
      WHERE n.author_id = ? AND n.created_at >= ? AND n.created_at <= ?`,
    [guard, from, to],
  );
  const vehicleRecords = useShiftVehicleRecords(guard || undefined, shift);

  return useMemo(() => {
    if (!shift) return null;
    const originOf = new Map(origins.map((o) => [o.ticket_id, o.to_value]));
    return {
      marinaName: settings.marinaName,
      shift: {
        id: shift.id,
        guard_id: shift.guard_id,
        guard_name: shift.guard_name,
        started_at: shift.started_at,
        ended_at: shift.ended_at,
        end_of_shift_checklist_id: shift.end_of_shift_checklist_id,
      },
      note,
      checkIns,
      checkpoints,
      locations,
      instances,
      sections,
      items,
      sectionCheckpoints,
      incidents: allIncidents
        .filter((i) => i.author_id === shift.guard_id)
        .map((i) => ({
          id: i.id,
          title: i.title,
          type_name: i.type_name,
          target_label: attachmentOf(i)?.label ?? null,
          created_at: i.created_at,
          status_name: i.status_name,
          status_is_terminal: i.status_is_terminal,
          details: i.details,
        })),
      tickets: allTickets
        .filter((t) => t.created_by_id === shift.guard_id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          target_label: attachmentOf(t)?.label ?? null,
          created_at: t.created_at,
          status_name: t.status_name,
          assignee_name: t.assignee_name,
          description: t.description,
          origin: originOf.get(t.id) ?? null,
        })),
      notes: notes.map((n) => ({ id: n.id, target_label: attachmentOf(n)?.label ?? null, created_at: n.created_at, body: n.body })),
      vehicles: compileVehicleUse({
        window: shiftWindowMs(shift),
        guardContactId: vehicleRecords.contactId,
        guardUserId: shift.guard_id,
        checkouts: vehicleRecords.checkouts,
        fuelLogs: vehicleRecords.fuelLogs,
        statusLogs: vehicleRecords.statusLogs,
        readings: vehicleRecords.readings,
        raised: vehicleRecords.raised,
      }),
    } satisfies CompileInputs;
  }, [shift, note, settings.marinaName, checkIns, checkpoints, locations, instances, sections, items, sectionCheckpoints, allIncidents, allTickets, origins, notes, vehicleRecords]);
}

/** The stored body, parsed; null until End of Shift has synced to this device. */
export function useShiftReportSnapshot(shiftId: string | undefined): ShiftReportDoc | null {
  const { data } = useQuery<{ document: string }>(
    "SELECT document FROM shift_report_snapshots WHERE shift_id = ?",
    [shiftId ?? ""],
  );
  return useMemo(() => {
    const raw = data[0]?.document;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ShiftReportDoc;
    } catch {
      return null;
    }
  }, [data]);
}

/** What moved after End of Shift, read live; the compiler attaches it to the document's records. */
export function useUpdatesSince(endedAt: string | null | undefined): SinceInputs {
  const after = endedAt ?? "9999";
  const { data: incidentComments } = useQuery<SinceInputs["incidentComments"][number]>(
    `SELECT c.id, c.incident_id, c.body, c.created_at, u.name AS author_name
       FROM incident_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.created_at > ?`,
    [after],
  );
  const { data: incidentUpdates } = useQuery<SinceInputs["incidentUpdates"][number]>(
    `SELECT x.id, x.incident_id, x.kind, x.from_value, x.to_value, x.created_at, u.name AS author_name
       FROM incident_updates x LEFT JOIN users u ON u.id = x.author_id WHERE x.created_at > ?`,
    [after],
  );
  const { data: ticketUpdates } = useQuery<SinceInputs["ticketUpdates"][number]>(
    `SELECT x.id, x.ticket_id, x.kind, x.from_value, x.to_value, x.body, x.created_at, u.name AS author_name
       FROM ticket_updates x LEFT JOIN users u ON u.id = x.author_id WHERE x.created_at > ?`,
    [after],
  );
  return { incidentComments, incidentUpdates, ticketUpdates };
}

/**
 * End Shift and Submit: the snapshot, ended_at and the Activity Log entry in
 * one transaction, so a shift never ends without its report or reports
 * without ending (spec § The End of Shift review).
 */
export async function endShiftWithReport(
  shift: { id: string },
  doc: ShiftReportDoc,
  user: { id: string; name: string },
): Promise<ShiftReportDoc> {
  const endedAt = stamp();
  const stored: ShiftReportDoc = { ...doc, shift: { ...doc.shift, endedAt } };
  await transact(async (tx) => {
    await update(tx, "shifts", shift.id, { ended_at: endedAt });
    // jsonb travels as text through the device's SQLite; uploadShape turns it
    // back into an object for Postgres (STRUCTURED_COLUMNS).
    await insert(tx, "shift_report_snapshots", {
      shift_id: shift.id,
      document: JSON.stringify(stored),
      created_at: endedAt,
    });
    await recordActivity(tx, {
      eventType: "shift.ended",
      summary: `Shift ended by ${user.name}`,
      subjectType: "shifts",
      subjectId: shift.id,
      actorId: user.id,
    });
  });
  return stored;
}
