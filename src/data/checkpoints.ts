import { useQuery } from "@powersync/react";
import { db } from "../lib/db";
import { insert, remove, transact, update } from "./sql";

// Checkpoints and tours.
//
// A checkpoint is a physical tag on a dock, a gate, a pump house. Its guid_url
// is what an NFC scan resolves — and that resolution has to work with no
// signal, standing in front of the tag, which is why the whole table is always
// resident and guid_url is indexed locally.

export interface CheckpointRow {
  id: string;
  name: string;
  guid_url: string;
  location_id: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_validation_radius: number | null;
  location_name: string | null;
}

const CHECKPOINT_SELECT = `
  SELECT c.*, l.name AS location_name
    FROM checkpoints c
    LEFT JOIN locations l ON l.id = c.location_id`;

export function useCheckpoints() {
  return useQuery<CheckpointRow>(`${CHECKPOINT_SELECT} ORDER BY c.name`);
}

export function useCheckpoint(checkpointId: string | undefined) {
  const { data, isLoading } = useQuery<CheckpointRow>(
    `${CHECKPOINT_SELECT} WHERE c.id = ?`,
    [checkpointId ?? ""],
  );
  return { checkpoint: data[0] ?? null, isLoading };
}

/** The scan path: a tag's GUID to the checkpoint it names. */
export function useCheckpointByGuid(guidUrl: string | undefined) {
  const { data, isLoading } = useQuery<CheckpointRow>(
    `${CHECKPOINT_SELECT} WHERE c.guid_url = ?`,
    [guidUrl ?? ""],
  );
  return { checkpoint: data[0] ?? null, isLoading };
}

export function useCheckpointsForLocation(locationId: string | undefined) {
  return useQuery<CheckpointRow>(
    `${CHECKPOINT_SELECT} WHERE c.location_id = ? ORDER BY c.name`,
    [locationId ?? ""],
  );
}

export interface CheckpointInput {
  name: string;
  guidUrl: string;
  locationId?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsValidationRadius?: number | null;
}

function checkpointColumns(input: Partial<CheckpointInput>) {
  return {
    name: input.name,
    guid_url: input.guidUrl,
    location_id: input.locationId === undefined ? undefined : input.locationId,
    gps_lat: input.gpsLat === undefined ? undefined : input.gpsLat,
    gps_lng: input.gpsLng === undefined ? undefined : input.gpsLng,
    gps_validation_radius:
      input.gpsValidationRadius === undefined ? undefined : input.gpsValidationRadius,
  };
}

export function createCheckpoint(input: CheckpointInput): Promise<string> {
  return insert(db, "checkpoints", checkpointColumns(input));
}

export function saveCheckpoint(
  checkpointId: string,
  input: Partial<CheckpointInput>,
): Promise<void> {
  return update(db, "checkpoints", checkpointId, checkpointColumns(input));
}

/**
 * Delete a checkpoint.
 *
 * check_ins.checkpoint_id is ON DELETE SET NULL, deliberately: a visit that
 * happened still happened after the tag it was made at is retired. The check-in
 * outlives the checkpoint rather than being erased with it.
 */
export function deleteCheckpoint(checkpointId: string): Promise<void> {
  return remove(db, "checkpoints", checkpointId);
}

// ---------------------------------------------------------------- tours

export interface TourRow {
  id: string;
  name: string;
  mode: string;
  checkpoint_count: number;
}

export function useTours() {
  return useQuery<TourRow>(
    `SELECT t.*,
            (SELECT COUNT(*) FROM tour_checkpoints tc WHERE tc.tour_id = t.id)
              AS checkpoint_count
       FROM tours t ORDER BY t.name`,
  );
}

export interface TourCheckpointRow extends CheckpointRow {
  tour_id: string;
  position: number;
  link_id: string;
}

export function useTourCheckpoints(tourId?: string) {
  return useQuery<TourCheckpointRow>(
    tourId
      ? `SELECT c.*, l.name AS location_name, tc.tour_id, tc.position, tc.id AS link_id
           FROM tour_checkpoints tc
           JOIN checkpoints c ON c.id = tc.checkpoint_id
           LEFT JOIN locations l ON l.id = c.location_id
          WHERE tc.tour_id = ? ORDER BY tc.position`
      : `SELECT c.*, l.name AS location_name, tc.tour_id, tc.position, tc.id AS link_id
           FROM tour_checkpoints tc
           JOIN checkpoints c ON c.id = tc.checkpoint_id
           LEFT JOIN locations l ON l.id = c.location_id
          ORDER BY tc.tour_id, tc.position`,
    tourId ? [tourId] : [],
  );
}

/** Tours a checkpoint belongs to. */
export function useToursForCheckpoint(checkpointId: string | undefined) {
  return useQuery<TourRow>(
    `SELECT t.*, 0 AS checkpoint_count FROM tours t
       JOIN tour_checkpoints tc ON tc.tour_id = t.id
      WHERE tc.checkpoint_id = ? ORDER BY t.name`,
    [checkpointId ?? ""],
  );
}

export function saveTour(tour: {
  id?: string;
  name: string;
  mode: string;
}): Promise<string> {
  const columns = { name: tour.name, mode: tour.mode };
  if (!tour.id) return insert(db, "tours", columns);
  return update(db, "tours", tour.id, columns).then(() => tour.id!);
}

export function deleteTour(tourId: string): Promise<void> {
  return remove(db, "tours", tourId);
}

/**
 * Replace a tour's checkpoints, in order.
 *
 * Position is rewritten wholesale because reordering is the common edit and a
 * partial update would leave gaps that a linear tour reads as skipped stops.
 */
export async function setTourCheckpoints(
  tourId: string,
  checkpointIds: string[],
): Promise<void> {
  await transact(async (tx) => {
    const existing = await tx.getAll<{ id: string; checkpoint_id: string }>(
      "SELECT id, checkpoint_id FROM tour_checkpoints WHERE tour_id = ?",
      [tourId],
    );
    for (const row of existing) {
      if (!checkpointIds.includes(row.checkpoint_id)) {
        await remove(tx, "tour_checkpoints", row.id);
      }
    }
    for (const [position, checkpointId] of checkpointIds.entries()) {
      const found = existing.find((e) => e.checkpoint_id === checkpointId);
      if (found) await update(tx, "tour_checkpoints", found.id, { position });
      else
        await insert(tx, "tour_checkpoints", {
          tour_id: tourId,
          checkpoint_id: checkpointId,
          position,
        });
    }
  });
}
