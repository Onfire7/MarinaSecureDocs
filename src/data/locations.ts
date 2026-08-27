import { useQuery } from "@powersync/react";
import { db, bool, json } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";
import type { PlacementShape } from "../lib/locations";

// Locations — the marina's own geography, and the types that shape it.
//
// Always resident. A slip's name, its type, its status and its map placement
// are read on nearly every screen, and a guard standing at one has no signal by
// definition, so all of it is on the device before it is needed.

export interface LocationTypeRow {
  id: string;
  name: string;
  allows_reservations: number;
  allows_leases: number;
  has_boat: number;
  has_vehicle: number;
  tracks_status: number;
}

export interface LocationRow {
  id: string;
  name: string;
  location_type_id: string;
  parent_id: string | null;
  status_id: string | null;
  post_reservation_status_id: string | null;
  reservation_enabled: number;
  reservation_visibility: string;
  lease_enabled: number;
  gps_lat: number | null;
  gps_lng: number | null;
  current_boat_id: string | null;
  current_vehicle_id: string | null;
  /** Joined for display. */
  type_name: string;
  tracks_status: number;
  status_name: string | null;
  boat_name: string | null;
  vehicle_description: string | null;
  child_count: number;
}

const LOCATION_SELECT = `
  SELECT l.*,
         t.name AS type_name,
         t.tracks_status,
         s.name AS status_name,
         b.name AS boat_name,
         v.description AS vehicle_description,
         (SELECT COUNT(*) FROM locations c WHERE c.parent_id = l.id) AS child_count
    FROM locations l
    JOIN location_types t ON t.id = l.location_type_id
    LEFT JOIN location_statuses s ON s.id = l.status_id
    LEFT JOIN boats b ON b.id = l.current_boat_id
    LEFT JOIN vehicles v ON v.id = l.current_vehicle_id`;

export function useLocations() {
  return useQuery<LocationRow>(
    // Numeric-aware ordering is a JavaScript concern — SQLite would put Slip 14
    // before Slip 9 — so the list pages sort with compareNames(). This ORDER BY
    // only makes the result stable between renders.
    `${LOCATION_SELECT} ORDER BY l.name`,
  );
}

export function useLocation(locationId: string | undefined) {
  const { data, isLoading } = useQuery<LocationRow>(
    `${LOCATION_SELECT} WHERE l.id = ?`,
    [locationId ?? ""],
  );
  return { location: data[0] ?? null, isLoading };
}

export function useChildLocations(parentId: string | undefined) {
  return useQuery<LocationRow>(
    `${LOCATION_SELECT} WHERE l.parent_id = ? ORDER BY l.name`,
    [parentId ?? ""],
  );
}

/**
 * Locations that can hold a boat, or a vehicle.
 *
 * The filter is on the TYPE, not the location: "can a boat go here" is a
 * property of being a slip, and a marina that invents a new slip-like type
 * gets it in this list without a code change.
 */
export function useLocationsHolding(what: "boat" | "vehicle") {
  const column = what === "boat" ? "has_boat" : "has_vehicle";
  return useQuery<LocationRow>(
    `${LOCATION_SELECT} WHERE t.${column} = 1 ORDER BY l.name`,
  );
}

export function useLocationTypes() {
  return useQuery<LocationTypeRow>("SELECT * FROM location_types ORDER BY name");
}

/**
 * The parent→child type rules, as a list of pairs.
 *
 * A type may nest under several others (a Slip under a Dock or a Basin), which
 * is why this is its own table rather than a column.
 */
export function useLocationTypeParents() {
  return useQuery<{ id: string; parent_type_id: string; child_type_id: string }>(
    "SELECT * FROM location_type_parents",
  );
}

export async function setLocationStatus(
  location: { id: string; name: string },
  status: { id: string; name: string },
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "locations", location.id, { status_id: status.id });
    await recordActivity(tx, {
      eventType: "location.status_changed",
      summary: `${location.name} set to ${status.name}`,
      subjectType: "locations",
      subjectId: location.id,
      actorId,
    });
  });
}

export interface LocationInput {
  name: string;
  locationTypeId: string;
  parentId?: string | null;
  statusId?: string | null;
  postReservationStatusId?: string | null;
  reservationEnabled?: boolean;
  reservationVisibility?: string;
  leaseEnabled?: boolean;
  gpsLat?: number | null;
  gpsLng?: number | null;
}

function locationColumns(input: Partial<LocationInput>) {
  return {
    name: input.name,
    location_type_id: input.locationTypeId,
    parent_id: input.parentId === undefined ? undefined : input.parentId,
    status_id: input.statusId === undefined ? undefined : input.statusId,
    post_reservation_status_id:
      input.postReservationStatusId === undefined
        ? undefined
        : input.postReservationStatusId,
    reservation_enabled:
      input.reservationEnabled === undefined ? undefined : input.reservationEnabled ? 1 : 0,
    reservation_visibility: input.reservationVisibility,
    lease_enabled:
      input.leaseEnabled === undefined ? undefined : input.leaseEnabled ? 1 : 0,
    gps_lat: input.gpsLat === undefined ? undefined : input.gpsLat,
    gps_lng: input.gpsLng === undefined ? undefined : input.gpsLng,
  };
}

export function createLocation(input: LocationInput): Promise<string> {
  return insert(db, "locations", locationColumns(input));
}

export function saveLocation(
  locationId: string,
  input: Partial<LocationInput>,
): Promise<void> {
  return update(db, "locations", locationId, locationColumns(input));
}

/**
 * Delete a location.
 *
 * `locations.parent_id` is ON DELETE RESTRICT, so a location with children
 * cannot be removed and the database says so rather than silently taking a
 * subtree with it. Callers surface that instead of pre-checking, because the
 * check and the delete would not be atomic anyway.
 */
export function deleteLocation(locationId: string): Promise<void> {
  return remove(db, "locations", locationId);
}

export function saveLocationType(type: {
  id?: string;
  name: string;
  allowsReservations: boolean;
  allowsLeases: boolean;
  hasBoat: boolean;
  hasVehicle: boolean;
  tracksStatus: boolean;
}): Promise<string> {
  const columns = {
    name: type.name,
    allows_reservations: type.allowsReservations ? 1 : 0,
    allows_leases: type.allowsLeases ? 1 : 0,
    has_boat: type.hasBoat ? 1 : 0,
    has_vehicle: type.hasVehicle ? 1 : 0,
    tracks_status: type.tracksStatus ? 1 : 0,
  };
  if (!type.id) return insert(db, "location_types", columns);
  return update(db, "location_types", type.id, columns).then(() => type.id!);
}

export function deleteLocationType(typeId: string): Promise<void> {
  return remove(db, "location_types", typeId);
}

/** Replace a type's permitted parents with exactly `parentTypeIds`. */
export async function setTypeParents(
  childTypeId: string,
  parentTypeIds: string[],
): Promise<void> {
  await transact(async (tx) => {
    const existing = await tx.getAll<{ id: string; parent_type_id: string }>(
      "SELECT id, parent_type_id FROM location_type_parents WHERE child_type_id = ?",
      [childTypeId],
    );
    for (const row of existing) {
      if (!parentTypeIds.includes(row.parent_type_id)) {
        await remove(tx, "location_type_parents", row.id);
      }
    }
    for (const parentTypeId of parentTypeIds) {
      if (!existing.some((e) => e.parent_type_id === parentTypeId)) {
        await insert(tx, "location_type_parents", {
          parent_type_id: parentTypeId,
          child_type_id: childTypeId,
        });
      }
    }
  });
}

// ---------------------------------------------------------------- maps

export interface MarinaMapRow {
  id: string;
  name: string;
  scope_id: string | null;
  image_attachment_id: string | null;
  scope_name: string | null;
  scope_parent_id: string | null;
  image_path: string | null;
}

export interface PlacementRow {
  id: string;
  map_id: string;
  location_id: string;
  placement: string | null;
  location_name: string;
}

export function useMarinaMaps() {
  return useQuery<MarinaMapRow>(
    `SELECT m.*, l.name AS scope_name, l.parent_id AS scope_parent_id,
            a.storage_path AS image_path
       FROM marina_maps m
       LEFT JOIN locations l ON l.id = m.scope_id
       LEFT JOIN attachments a ON a.id = m.image_attachment_id
      ORDER BY m.name`,
  );
}

export function usePlacements(mapId?: string) {
  return useQuery<PlacementRow>(
    mapId
      ? `SELECT p.*, l.name AS location_name FROM location_map_placements p
           JOIN locations l ON l.id = p.location_id WHERE p.map_id = ?`
      : `SELECT p.*, l.name AS location_name FROM location_map_placements p
           JOIN locations l ON l.id = p.location_id`,
    mapId ? [mapId] : [],
  );
}

export function placementOf(row: PlacementRow): PlacementShape {
  return json<PlacementShape>(row.placement, { cx: 50, cy: 50, rotation: 0 });
}

export function savePlacement(
  placementId: string,
  shape: PlacementShape,
): Promise<void> {
  return update(db, "location_map_placements", placementId, {
    placement: JSON.stringify(shape),
  });
}

export function createPlacement(
  mapId: string,
  locationId: string,
  shape: PlacementShape,
): Promise<string> {
  return insert(db, "location_map_placements", {
    map_id: mapId,
    location_id: locationId,
    placement: JSON.stringify(shape),
  });
}

export function deletePlacement(placementId: string): Promise<void> {
  return remove(db, "location_map_placements", placementId);
}

export function saveMarinaMap(map: {
  id?: string;
  name: string;
  scopeId?: string | null;
  imageAttachmentId?: string | null;
}): Promise<string> {
  const columns = {
    name: map.name,
    scope_id: map.scopeId ?? null,
    image_attachment_id: map.imageAttachmentId ?? null,
  };
  if (!map.id) return insert(db, "marina_maps", columns);
  return update(db, "marina_maps", map.id, columns).then(() => map.id!);
}

export function deleteMarinaMap(mapId: string): Promise<void> {
  return remove(db, "marina_maps", mapId);
}

/** `tracks_status` as a boolean — the flag deciding whether a status shows. */
export function tracksStatus(location: { tracks_status: number }): boolean {
  return bool(location.tracks_status);
}
