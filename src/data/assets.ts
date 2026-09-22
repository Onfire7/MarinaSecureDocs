import { useQuery } from "@powersync/react";
import { db, stamp } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";
import {
  dueMeterMaintenanceRules,
  maintenanceRuleTitle,
} from "../lib/maintenanceRules";

// Assets — the marina's radios, carts, tools and pumps.
//
// Two things moved out of the asset row in the migration, and both are better
// for it:
//
//   * Status. There is no `assets.status_id`. The current status is the most
//     recent asset_status_logs row, so "what is it now" and "how did it get
//     that way" are the same query rather than a column plus a log that can
//     disagree.
//   * Maintenance rules. They were a json array on the asset; they are rows
//     now, so a rule can be edited without rewriting the asset, and the meter
//     check reads them without parsing.

export interface AssetRow {
  id: string;
  name: string;
  category: string | null;
  location_id: string | null;
  has_meter: number;
  meter_type: string | null;
  meter_reading: number | null;
  checkoutable: number;
  reservation_enabled: number;
  reservation_visibility: string;
  post_return_status_id: string | null;
  location_name: string | null;
  status_id: string | null;
  status_name: string | null;
  /** The open checkout, if the asset is out right now. */
  checkout_id: string | null;
  checked_out_to: string | null;
  checked_out_at: string | null;
}

// The current status is a correlated subquery rather than a join, because
// "latest row per group" has no join form that stays correct when two logs
// share a timestamp — which they do, when a checklist submits several at once.
const ASSET_SELECT = `
  SELECT a.*,
         l.name AS location_name,
         sl.status_id,
         st.name AS status_name,
         co.id AS checkout_id,
         co.time_out AS checked_out_at,
         p.name AS checked_out_to
    FROM assets a
    LEFT JOIN locations l ON l.id = a.location_id
    LEFT JOIN asset_status_logs sl
           ON sl.id = (SELECT s2.id FROM asset_status_logs s2
                        WHERE s2.asset_id = a.id
                        ORDER BY s2.timestamp DESC, s2.id DESC LIMIT 1)
    LEFT JOIN asset_statuses st ON st.id = sl.status_id
    LEFT JOIN asset_checkouts co
           ON co.asset_id = a.id AND co.time_in IS NULL
    LEFT JOIN contacts p ON p.id = co.person_id`;

export function useAssets() {
  return useQuery<AssetRow>(`${ASSET_SELECT} ORDER BY a.name`);
}

export function useAsset(assetId: string | undefined) {
  const { data, isLoading } = useQuery<AssetRow>(`${ASSET_SELECT} WHERE a.id = ?`, [
    assetId ?? "",
  ]);
  return { asset: data[0] ?? null, isLoading };
}

export interface MaintenanceRuleRow {
  id: string;
  asset_id: string;
  kind: string;
  every: number;
  label: string | null;
}

export function useMaintenanceRules(assetId?: string) {
  return useQuery<MaintenanceRuleRow>(
    assetId
      ? "SELECT * FROM maintenance_rules WHERE asset_id = ? ORDER BY every"
      : "SELECT * FROM maintenance_rules ORDER BY asset_id, every",
    assetId ? [assetId] : [],
  );
}

export interface MeterReadingRow {
  id: string;
  asset_id: string;
  value: number;
  source: string;
  timestamp: string;
  correction_reason: string | null;
  logged_by_id: string | null;
  logged_by_name: string | null;
}

export function useMeterReadings(assetId: string | undefined, limit = 50) {
  return useQuery<MeterReadingRow>(
    `SELECT r.*, u.name AS logged_by_name
       FROM asset_meter_readings r
       LEFT JOIN users u ON u.id = r.logged_by_id
      WHERE r.asset_id = ? ORDER BY r.timestamp DESC LIMIT ?`,
    [assetId ?? "", limit],
  );
}

export interface StatusLogRow {
  id: string;
  asset_id: string;
  status_id: string;
  note: string | null;
  timestamp: string;
  logged_by_id: string | null;
  status_name: string | null;
  logged_by_name: string | null;
}

export function useAssetStatusLog(assetId: string | undefined, limit = 50) {
  return useQuery<StatusLogRow>(
    `SELECT sl.*, st.name AS status_name, u.name AS logged_by_name
       FROM asset_status_logs sl
       LEFT JOIN asset_statuses st ON st.id = sl.status_id
       LEFT JOIN users u ON u.id = sl.logged_by_id
      WHERE sl.asset_id = ? ORDER BY sl.timestamp DESC LIMIT ?`,
    [assetId ?? "", limit],
  );
}

export interface CheckoutRow {
  id: string;
  asset_id: string;
  person_id: string | null;
  checked_out_by_id: string | null;
  time_out: string;
  time_in: string | null;
  person_name: string | null;
  checked_out_by_name: string | null;
}

export function useCheckoutHistory(assetId: string | undefined, limit = 25) {
  return useQuery<CheckoutRow>(
    `SELECT co.*, p.name AS person_name, u.name AS checked_out_by_name
       FROM asset_checkouts co
       LEFT JOIN contacts p ON p.id = co.person_id
       LEFT JOIN users u ON u.id = co.checked_out_by_id
      WHERE co.asset_id = ? ORDER BY co.time_out DESC LIMIT ?`,
    [assetId ?? "", limit],
  );
}

export interface AssetInput {
  name: string;
  category?: string | null;
  locationId?: string | null;
  hasMeter?: boolean;
  meterType?: string | null;
  checkoutable?: boolean;
  reservationEnabled?: boolean;
  reservationVisibility?: string;
  postReturnStatusId?: string | null;
}

function assetColumns(input: Partial<AssetInput>) {
  return {
    name: input.name,
    category: input.category === undefined ? undefined : input.category,
    location_id: input.locationId === undefined ? undefined : input.locationId,
    has_meter: input.hasMeter === undefined ? undefined : input.hasMeter ? 1 : 0,
    meter_type: input.meterType === undefined ? undefined : input.meterType,
    checkoutable:
      input.checkoutable === undefined ? undefined : input.checkoutable ? 1 : 0,
    reservation_enabled:
      input.reservationEnabled === undefined
        ? undefined
        : input.reservationEnabled
          ? 1
          : 0,
    reservation_visibility: input.reservationVisibility,
    post_return_status_id:
      input.postReturnStatusId === undefined ? undefined : input.postReturnStatusId,
  };
}

export function createAsset(input: AssetInput): Promise<string> {
  return insert(db, "assets", assetColumns(input));
}

export function saveAsset(assetId: string, input: Partial<AssetInput>): Promise<void> {
  return update(db, "assets", assetId, assetColumns(input));
}

export function deleteAsset(assetId: string): Promise<void> {
  return remove(db, "assets", assetId);
}

export function saveMaintenanceRule(rule: {
  id?: string;
  assetId: string;
  kind: string;
  every: number;
  label?: string | null;
}): Promise<string> {
  const columns = {
    asset_id: rule.assetId,
    kind: rule.kind,
    every: rule.every,
    label: rule.label ?? null,
  };
  if (!rule.id) return insert(db, "maintenance_rules", columns);
  return update(db, "maintenance_rules", rule.id, columns).then(() => rule.id!);
}

export function deleteMaintenanceRule(ruleId: string): Promise<void> {
  return remove(db, "maintenance_rules", ruleId);
}

/**
 * Rename an asset category everywhere it appears.
 *
 * Categories are not their own entity — they are the set of `assets.category`
 * strings in use — so renaming one is an update across every asset carrying
 * that label, done in the database rather than one write per asset.
 */
export function renameAssetCategory(from: string, to: string): Promise<void> {
  return transact(async (tx) => {
    await tx.execute("UPDATE assets SET category = ? WHERE category = ?", [to, from]);
  });
}

/** Move an asset to a location, or take it off one. */
export async function moveAsset(
  asset: { id: string; name: string },
  from: { name: string } | null,
  to: { id: string; name: string } | null,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "assets", asset.id, { location_id: to?.id ?? null });
    await recordActivity(tx, {
      eventType: "asset.location_changed",
      summary: to
        ? `${asset.name} moved to ${to.name}`
        : `${asset.name} removed from ${from?.name ?? "its location"}`,
      subjectType: "assets",
      subjectId: asset.id,
      actorId,
    });
  });
}

export async function setAssetStatus(
  asset: { id: string; name: string },
  status: { id: string; name: string },
  note: string | null,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    // Appending to the log IS setting the status. There is no column to keep
    // in step with it, which is the point.
    await insert(tx, "asset_status_logs", {
      asset_id: asset.id,
      status_id: status.id,
      note,
      timestamp: stamp(),
      logged_by_id: actorId,
    });
    await recordActivity(tx, {
      eventType: "asset.status_changed",
      summary: `${asset.name} set to ${status.name}`,
      subjectType: "assets",
      subjectId: asset.id,
      actorId,
    });
  });
}

/**
 * Check an asset out.
 *
 * `when` is the time it actually left, which the dialog lets you edit — a
 * radio handed out at the start of a shift is often logged an hour later, and
 * recording "now" would make the checkout log disagree with the shift it
 * belongs to.
 */
export async function checkOutAsset(
  asset: { id: string; name: string },
  person: { id: string; name: string | null },
  when: Date,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await insert(tx, "asset_checkouts", {
      asset_id: asset.id,
      person_id: person.id,
      checked_out_by_id: actorId,
      time_out: stamp(when),
    });
    await recordActivity(tx, {
      eventType: "asset.checked_out",
      summary: `${asset.name} checked out to ${person.name ?? "someone"}`,
      subjectType: "assets",
      subjectId: asset.id,
      actorId,
    });
  });
}

export async function checkInAsset(
  asset: { id: string; name: string; post_return_status_id: string | null },
  checkoutId: string,
  postReturnStatus: { id: string; name: string } | null,
  when: Date,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "asset_checkouts", checkoutId, { time_in: stamp(when) });
    if (postReturnStatus) {
      await insert(tx, "asset_status_logs", {
        asset_id: asset.id,
        status_id: postReturnStatus.id,
        note: "Returned from checkout",
        timestamp: stamp(when),
        logged_by_id: actorId,
      });
    }
    await recordActivity(tx, {
      eventType: "asset.checked_in",
      summary: `${asset.name} returned`,
      subjectType: "assets",
      subjectId: asset.id,
      actorId,
    });
  });
}

/**
 * Record a meter reading, and raise any maintenance it makes due.
 *
 * All in one transaction, because the reading and the tickets it triggers are
 * one event: a device that recorded the reading and then went flat would
 * otherwise leave an asset past its service interval with nothing saying so,
 * and the next reading would compute the same baseline and raise it again.
 */
export async function recordMeterReading(
  asset: AssetRow,
  value: number,
  source: "manual" | "checklist_item",
  correctionReason: string | null,
  ticketStatusId: string | null,
  actorId: string | null,
): Promise<string[]> {
  const rules = await db.getAll<MaintenanceRuleRow>(
    "SELECT * FROM maintenance_rules WHERE asset_id = ?",
    [asset.id],
  );
  const priorReadings = await db.getAll<MeterReadingRow>(
    "SELECT * FROM asset_meter_readings WHERE asset_id = ? ORDER BY timestamp",
    [asset.id],
  );
  const existingTickets = await db.getAll<{
    title: string;
    auto_generated: number;
    created_at: string;
    resolved_at: string | null;
  }>(
    "SELECT title, auto_generated, created_at, resolved_at FROM tickets WHERE asset_id = ?",
    [asset.id],
  );

  const due = dueMeterMaintenanceRules(
    asset,
    rules,
    value,
    priorReadings,
    existingTickets,
  );

  return transact(async (tx) => {
    await insert(tx, "asset_meter_readings", {
      asset_id: asset.id,
      value,
      source,
      timestamp: stamp(),
      correction_reason: correctionReason,
      logged_by_id: actorId,
    });
    // assets.meter_reading is a cache of the newest reading, kept because
    // every list column and every maintenance comparison wants it and none of
    // them wants the history. Unlike status, which has no such column, this one
    // CAN disagree with its log — so it is written in the same transaction as
    // the reading, never separately.
    await update(tx, "assets", asset.id, { meter_reading: value });
    await recordActivity(tx, {
      eventType: "asset.meter_updated",
      summary: `${asset.name} meter set to ${value}`,
      subjectType: "assets",
      subjectId: asset.id,
      actorId,
    });

    const raised: string[] = [];
    for (const rule of due) {
      if (!ticketStatusId) break;
      const title = maintenanceRuleTitle(asset, rule);
      const ticketId = await insert(tx, "tickets", {
        title,
        description: `Raised automatically at ${value}.`,
        priority: "medium",
        status_id: ticketStatusId,
        auto_generated: 1,
        created_at: stamp(),
        created_by_id: actorId,
        asset_id: asset.id,
      });
      await recordActivity(tx, {
        eventType: "ticket.created",
        summary: `Ticket "${title}" created on ${asset.name}`,
        subjectType: "tickets",
        subjectId: ticketId,
        actorId,
      });
      raised.push(title);
    }
    return raised;
  });
}
