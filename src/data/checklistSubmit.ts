import type { LockContext } from "@powersync/web";
import { db, stamp } from "../lib/db";
import { insert, update } from "./sql";
import { recordActivity } from "./activity";
import {
  dueMeterMaintenanceRules,
  maintenanceRuleTitle,
} from "../lib/maintenanceRules";
import { isStateCheck } from "../lib/checklists";
import type {
  DoorCheckResult,
  ItemResult,
  PendingIncident,
  PendingMeterReading,
  PendingTicket,
} from "../lib/checklists";
import { attachmentColumns, type TargetType } from "./attachments";
import type { MaintenanceRuleRow, MeterReadingRow } from "./assets";

/**
 * Turns the side effects an item *described* while the guard worked into the
 * rows they represent, at submit time (see docs/pages/active-checklist.html).
 *
 * Nothing here runs until the checklist is submitted, which is what makes a
 * completed item editable: redoing an item only rewrites its own result, because
 * no incident, ticket, meter reading or asset mutation exists yet to unwind.
 */

export interface Collected {
  incidents: PendingIncident[];
  tickets: PendingTicket[];
  readings: PendingMeterReading[];
  /** result-row id → ticket id, so a linked ticket can be attached at submit. */
  ticketByResultId: Map<string, string>;
}

export function collectPendingEffects(
  rows: { id: string; result?: ItemResult | null }[],
): Collected {
  const out: Collected = {
    incidents: [],
    tickets: [],
    readings: [],
    ticketByResultId: new Map(),
  };
  for (const row of rows) {
    const r = row.result;
    if (!r) continue;
    if (isStateCheck(r.type)) {
      // isStateCheck narrows the type string, not the result union, and legacy
      // rows may still carry the pre-rename type.
      const sc = r as DoorCheckResult;
      if (sc.pendingIncident) out.incidents.push(sc.pendingIncident);
      if (sc.pendingTicket) {
        out.tickets.push(sc.pendingTicket);
        out.ticketByResultId.set(row.id, sc.pendingTicket.id);
      }
    } else if (r.type === "verify_task") {
      if (r.pendingTicket) {
        out.tickets.push(r.pendingTicket);
        out.ticketByResultId.set(row.id, r.pendingTicket.id);
      }
    } else if (r.type === "meter_reading") {
      if (r.pendingReading) out.readings.push(r.pendingReading);
    }
  }
  return out;
}

export interface MaintenanceCheck {
  assetId: string;
  assetName: string;
  reading: PendingMeterReading;
  titles: string[];
}

/**
 * Which maintenance rules the readings in this submit would make due.
 *
 * Read BEFORE the submit transaction opens, because it needs live history —
 * a rule someone else already ticketed must not be ticketed again — and a
 * transaction that reads and writes the same rows would be deciding against
 * its own uncommitted state.
 */
export async function checkMaintenance(
  collected: Collected,
): Promise<MaintenanceCheck[]> {
  const out: MaintenanceCheck[] = [];
  for (const reading of collected.readings) {
    const asset = await db.getOptional<{ id: string; name: string }>(
      "SELECT id, name FROM assets WHERE id = ?",
      [reading.assetId],
    );
    if (!asset) continue;
    const rules = await db.getAll<MaintenanceRuleRow>(
      "SELECT * FROM maintenance_rules WHERE asset_id = ?",
      [reading.assetId],
    );
    const priorReadings = await db.getAll<MeterReadingRow>(
      "SELECT * FROM asset_meter_readings WHERE asset_id = ? ORDER BY timestamp",
      [reading.assetId],
    );
    const tickets = await db.getAll<{
      title: string;
      auto_generated: number;
      created_at: string;
      resolved_at: string | null;
    }>(
      "SELECT title, auto_generated, created_at, resolved_at FROM tickets WHERE asset_id = ?",
      [reading.assetId],
    );
    const due = dueMeterMaintenanceRules(
      asset,
      rules,
      reading.value,
      priorReadings,
      tickets,
    );
    if (due.length > 0) {
      out.push({
        assetId: asset.id,
        assetName: asset.name,
        reading,
        titles: due.map((rule) => maintenanceRuleTitle(asset, rule)),
      });
    }
  }
  return out;
}

/**
 * Write every deferred effect, inside the submit's own transaction.
 *
 * Ids were minted when the guard recorded the finding, so a replayed write
 * queue produces the same incident rather than a second one — and a result row
 * can reference the ticket it raised before that ticket exists.
 *
 * Timestamps are `openedAt`, not now: a door found open at 02:10 and submitted
 * at 05:45 reports as having been found open at 02:10.
 */
export async function writePendingEffects(
  tx: LockContext,
  collected: Collected,
  maintenance: MaintenanceCheck[],
  statusIds: { incidentOpen: string | null; ticketOpen: string | null },
  actorId: string | null,
): Promise<void> {
  for (const incident of collected.incidents) {
    if (!statusIds.incidentOpen) break;
    await insert(tx, "incidents", {
      id: incident.id,
      title: incident.title,
      status_id: statusIds.incidentOpen,
      details: incident.details || null,
      created_at: stamp(incident.openedAt),
      author_id: actorId,
      ...attachmentColumns(
        incident.target
          ? {
              type: incident.target.type as TargetType,
              id: incident.target.id,
              label: incident.target.label,
            }
          : null,
      ),
    });
    await recordActivity(tx, {
      eventType: "incident.created",
      summary: incident.title,
      subjectType: "incidents",
      subjectId: incident.id,
      actorId,
    });
  }

  for (const ticket of collected.tickets) {
    if (!statusIds.ticketOpen) break;
    await insert(tx, "tickets", {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description || null,
      priority: ticket.priority,
      status_id: statusIds.ticketOpen,
      auto_generated: ticket.autoGenerated ? 1 : 0,
      created_at: stamp(ticket.openedAt),
      created_by_id: actorId,
      source_incident_id: ticket.sourceIncidentId ?? null,
      asset_id: ticket.assetId ?? null,
    });
  }

  for (const reading of collected.readings) {
    await insert(tx, "asset_meter_readings", {
      id: reading.id,
      asset_id: reading.assetId,
      value: reading.value,
      source: "checklist_item",
      timestamp: stamp(reading.openedAt),
      correction_reason: reading.correctionReason ?? null,
      logged_by_id: actorId,
    });
    await update(tx, "assets", reading.assetId, { meter_reading: reading.value });
  }

  for (const check of maintenance) {
    if (!statusIds.ticketOpen) break;
    for (const title of check.titles) {
      const ticketId = await insert(tx, "tickets", {
        title,
        description: `Raised automatically at ${check.reading.value}.`,
        priority: "medium",
        status_id: statusIds.ticketOpen,
        auto_generated: 1,
        created_at: stamp(check.reading.openedAt),
        created_by_id: actorId,
        asset_id: check.assetId,
      });
      await recordActivity(tx, {
        eventType: "ticket.created",
        summary: `Ticket "${title}" created on ${check.assetName}`,
        subjectType: "tickets",
        subjectId: ticketId,
        actorId,
      });
    }
  }
}
