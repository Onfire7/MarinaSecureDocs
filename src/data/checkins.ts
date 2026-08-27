import { useQuery } from "@powersync/react";
import { db, stamp } from "../lib/db";
import { insert, transact } from "./sql";
import { recordActivity } from "./activity";

// Check-ins — the record that someone was physically at a checkpoint.
//
// Age-scoped: the trailing window keeps recent rounds on the device and lets
// the rest fall off. What does NOT fall off is the row in Postgres — a check-in
// is evidentiary, and check_ins.checkpoint_id is ON DELETE SET NULL so a visit
// survives the retirement of the tag it was made at. That is why checkpoint
// details here are nullable and rendered as "(removed checkpoint)" rather than
// assumed present.

export interface CheckInRow {
  id: string;
  checkpoint_id: string | null;
  user_id: string;
  timestamp: string;
  method: string;
  gps_lat: number | null;
  gps_lng: number | null;
  within_radius: number | null;
  reason: string | null;
  checkpoint_name: string | null;
  user_name: string | null;
}

const CHECKIN_SELECT = `
  SELECT ci.*, cp.name AS checkpoint_name, u.name AS user_name
    FROM check_ins ci
    LEFT JOIN checkpoints cp ON cp.id = ci.checkpoint_id
    LEFT JOIN users u ON u.id = ci.user_id`;

export function useRecentCheckIns(checkpointId: string | undefined, limit = 10) {
  return useQuery<CheckInRow>(
    `${CHECKIN_SELECT} WHERE ci.checkpoint_id = ?
      ORDER BY ci.timestamp DESC LIMIT ?`,
    [checkpointId ?? "", limit],
  );
}

/**
 * Every check-in a user made inside a time window — the shift report's spine.
 *
 * A check-in carries no shift id: it is tied to a shift by *when* it happened
 * and *who* made it, which is the only definition that still holds when the
 * shift was started on one device and the check-in made on another.
 */
export function useCheckInsInWindow(
  userId: string | undefined,
  from: string,
  to: string,
) {
  return useQuery<CheckInRow>(
    `${CHECKIN_SELECT}
      WHERE ci.user_id = ? AND ci.timestamp >= ? AND ci.timestamp <= ?
      ORDER BY ci.timestamp`,
    [userId ?? "", from, to],
  );
}

export function useCheckInsForUserSince(
  userId: string | undefined,
  since: string,
) {
  return useQuery<CheckInRow>(
    `${CHECKIN_SELECT} WHERE ci.user_id = ? AND ci.timestamp >= ?
      ORDER BY ci.timestamp DESC`,
    [userId ?? "", since],
  );
}

export interface NewCheckIn {
  checkpointId: string;
  checkpointName: string;
  userId: string;
  method: "scanned" | "manual";
  gpsLat?: number | null;
  gpsLng?: number | null;
  withinRadius?: boolean | null;
  /** Why a manual check-in was needed — "tag wouldn't read", and so on. */
  reason?: string | null;
}

export async function recordCheckIn(input: NewCheckIn): Promise<string> {
  return transact(async (tx) => {
    const checkInId = await insert(tx, "check_ins", {
      checkpoint_id: input.checkpointId,
      user_id: input.userId,
      timestamp: stamp(),
      method: input.method,
      gps_lat: input.gpsLat ?? null,
      gps_lng: input.gpsLng ?? null,
      within_radius:
        input.withinRadius === null || input.withinRadius === undefined
          ? null
          : input.withinRadius
            ? 1
            : 0,
      reason: input.reason ?? null,
    });
    await recordActivity(tx, {
      eventType: input.method === "scanned" ? "checkin.scanned" : "checkin.manual",
      summary: `Checked in at ${input.checkpointName}`,
      subjectType: "check_ins",
      subjectId: checkInId,
      actorId: input.userId,
    });
    return checkInId;
  });
}

/** The most recent check-in at a checkpoint, for the "last visited" line. */
export function lastCheckInAt(checkpointId: string): Promise<CheckInRow | null> {
  return db.getOptional<CheckInRow>(
    `${CHECKIN_SELECT} WHERE ci.checkpoint_id = ?
      ORDER BY ci.timestamp DESC LIMIT 1`,
    [checkpointId],
  );
}
