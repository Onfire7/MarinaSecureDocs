import { useQuery } from "@powersync/react";
import { db, bool } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";
import type { LabelShape } from "../lib/locations";

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
  retired_at: string | null;
  last_occupancy_audit_at: string | null;
  last_status_audit_at: string | null;
  /** Joined for display. */
  type_name: string;
  tracks_status: number;
  status_name: string | null;
  /**
   * Occupants. A location holds any number of boats and vehicles (ADR 0006);
   * `boat_id` is the first by name, `boat_name` every name joined with ", ".
   */
  boat_id: string | null;
  boat_name: string | null;
  boat_count: number;
  vehicle_id: string | null;
  vehicle_description: string | null;
  vehicle_count: number;
  child_count: number;
}

// Occupants are correlated subqueries on boats.location_id rather than a
// LEFT JOIN: a join on anything but `id` is a full scan per row in PowerSync's
// SQLite (see CLAUDE.md), and this select runs for every location on the list.
const LOCATION_SELECT = `
  SELECT l.*,
         t.name AS type_name,
         t.tracks_status,
         s.name AS status_name,
         (SELECT b.id   FROM boats b WHERE b.location_id = l.id ORDER BY b.name LIMIT 1) AS boat_id,
         (SELECT group_concat(b.name, ', ') FROM boats b WHERE b.location_id = l.id) AS boat_name,
         (SELECT COUNT(*) FROM boats b WHERE b.location_id = l.id) AS boat_count,
         (SELECT v.id FROM vehicles v WHERE v.location_id = l.id ORDER BY v.description LIMIT 1) AS vehicle_id,
         (SELECT group_concat(v.description, ', ') FROM vehicles v WHERE v.location_id = l.id) AS vehicle_description,
         (SELECT COUNT(*) FROM vehicles v WHERE v.location_id = l.id) AS vehicle_count,
         (SELECT COUNT(*) FROM locations c WHERE c.parent_id = l.id) AS child_count
    FROM locations l
    JOIN location_types t ON t.id = l.location_type_id
    LEFT JOIN location_statuses s ON s.id = l.status_id`;

export function useLocations() {
  return useQuery<LocationRow>(
    // Numeric-aware ordering is a JavaScript concern — SQLite would put Slip 14
    // before Slip 9 — so the list pages sort with compareNames(). This ORDER BY
    // only makes the result stable between renders.
    `${LOCATION_SELECT} WHERE l.retired_at IS NULL ORDER BY l.name`,
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
    `${LOCATION_SELECT} WHERE l.parent_id = ? AND l.retired_at IS NULL ORDER BY l.name`,
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
    `${LOCATION_SELECT} WHERE t.${column} = 1 AND l.retired_at IS NULL ORDER BY l.name`,
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

/**
 * Apply the same change to many locations at once — the bulk-edit bar.
 *
 * One transaction, so a bulk edit either happens or does not. Callers skip
 * rows the change does not apply to (a type that does not allow leases) and
 * report the count, rather than writing a field the type has no meaning for.
 */
export async function bulkUpdateLocations(
  edits: { id: string; changes: Partial<LocationInput> }[],
): Promise<void> {
  await transact(async (tx) => {
    for (const edit of edits) {
      await update(tx, "locations", edit.id, locationColumns(edit.changes));
    }
  });
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

export interface LocationDependencies {
  children: number;
  checkpoints: number;
  maps: number;
  leases: number;
  reservations: number;
  incidents: number;
  tickets: number;
  notes: number;
  placements: number;
  has_boat: number;
  has_vehicle: number;
}

/**
 * Everything that would break if this location were deleted.
 *
 * Deliberately one query scoped to one location and mounted only while its row
 * is expanded: the tree view would otherwise pull every ticket and reservation
 * in the marina to render a disabled button.
 *
 * Only map placements are allowed to go with it — they carry no information of
 * their own once the location is gone. Everything else blocks, and the database
 * agrees: those foreign keys are ON DELETE RESTRICT, so this check is a courtesy
 * that explains WHICH thing rather than the thing preventing the delete.
 */
export function useLocationDependencies(locationId: string) {
  const { data, isLoading } = useQuery<LocationDependencies>(
    `SELECT
       (SELECT COUNT(*) FROM locations WHERE parent_id = ?1) AS children,
       (SELECT COUNT(*) FROM checkpoints WHERE location_id = ?1) AS checkpoints,
       (SELECT COUNT(*) FROM marina_maps WHERE scope_id = ?1) AS maps,
       (SELECT COUNT(*) FROM leases WHERE location_id = ?1) AS leases,
       (SELECT COUNT(*) FROM reservations WHERE location_id = ?1) AS reservations,
       (SELECT COUNT(*) FROM incidents WHERE location_id = ?1) AS incidents,
       (SELECT COUNT(*) FROM tickets WHERE location_id = ?1) AS tickets,
       (SELECT COUNT(*) FROM notes WHERE location_id = ?1) AS notes,
       (SELECT COUNT(*) FROM map_anchors WHERE location_id = ?1) + (SELECT COUNT(*) FROM map_labels WHERE location_id = ?1) AS placements,
       (SELECT COUNT(*) FROM boats WHERE location_id = ?1) AS has_boat,
       (SELECT COUNT(*) FROM vehicles WHERE location_id = ?1) AS has_vehicle`,
    [locationId],
  );
  return { dependencies: data[0] ?? null, isLoading };
}

/** Delete a location along with the map placements that only describe it. */
export async function deleteLocationWithPlacements(locationId: string): Promise<void> {
  await transact(async (tx) => {
    await tx.execute("DELETE FROM map_anchors WHERE location_id = ?", [locationId]);
    await tx.execute("DELETE FROM map_labels WHERE location_id = ?", [
      locationId,
    ]);
    await remove(tx, "locations", locationId);
  });
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

/** An anchor (docs/maps.md): where a location is on a map, with the GPS it
 *  stands for - or a free calibration point with no location. A located
 *  anchor's lat/lng mirror the location's (kept in step by trigger); on the
 *  device they may lag a sync behind, so readers fall back to the
 *  location's own coordinates. */
export interface MapAnchorRow {
  id: string;
  map_id: string;
  location_id: string | null;
  cx: number;
  cy: number;
  lat: number | null;
  lng: number | null;
  label: string | null;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
}

/** A label on a map: its own centre, independent of the anchor it names. */
export interface MapLabelRow {
  id: string;
  map_id: string;
  location_id: string;
  cx: number;
  cy: number;
  rotation: number;
  font_size: number | null;
  padding_x: number | null;
  padding_y: number | null;
  location_name: string;
}

export function useMapAnchors(mapId?: string) {
  return useQuery<MapAnchorRow>(
    `SELECT a.*, l.name AS location_name, l.gps_lat AS location_lat, l.gps_lng AS location_lng
       FROM map_anchors a LEFT JOIN locations l ON l.id = a.location_id
      ${mapId ? "WHERE a.map_id = ?" : ""}`,
    mapId ? [mapId] : [],
  );
}

export function useMapLabels(mapId?: string) {
  return useQuery<MapLabelRow>(
    `SELECT b.*, l.name AS location_name
       FROM map_labels b JOIN locations l ON l.id = b.location_id
      ${mapId ? "WHERE b.map_id = ?" : ""}`,
    mapId ? [mapId] : [],
  );
}

export function labelShapeOf(row: MapLabelRow): LabelShape {
  return {
    cx: row.cx,
    cy: row.cy,
    rotation: row.rotation ?? 0,
    fontSize: row.font_size ?? undefined,
    paddingX: row.padding_x ?? undefined,
    paddingY: row.padding_y ?? undefined,
  };
}

/** The coordinates an anchor stands for: its own, else its location's. */
export function anchorGps(row: MapAnchorRow): { lat: number; lng: number } | null {
  const lat = row.lat ?? row.location_lat;
  const lng = row.lng ?? row.location_lng;
  return lat !== null && lng !== null ? { lat, lng } : null;
}

export function createAnchor(input: { mapId: string; locationId: string | null; cx: number; cy: number; lat?: number | null; lng?: number | null; label?: string | null }): Promise<string> {
  return insert(db, "map_anchors", {
    map_id: input.mapId,
    location_id: input.locationId,
    cx: input.cx,
    cy: input.cy,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    label: input.label ?? null,
  });
}

export function saveAnchor(anchorId: string, changes: Partial<{ cx: number; cy: number; lat: number | null; lng: number | null; label: string | null }>): Promise<void> {
  return update(db, "map_anchors", anchorId, changes);
}

export function deleteAnchor(anchorId: string): Promise<void> {
  return remove(db, "map_anchors", anchorId);
}

function labelColumns(shape: LabelShape) {
  return {
    cx: shape.cx,
    cy: shape.cy,
    rotation: shape.rotation ?? 0,
    font_size: shape.fontSize ?? null,
    padding_x: shape.paddingX ?? null,
    padding_y: shape.paddingY ?? null,
  };
}

export function createLabel(mapId: string, locationId: string, shape: LabelShape): Promise<string> {
  return insert(db, "map_labels", { map_id: mapId, location_id: locationId, ...labelColumns(shape) });
}

export function saveLabel(labelId: string, shape: LabelShape): Promise<void> {
  return update(db, "map_labels", labelId, labelColumns(shape));
}

export function deleteLabel(labelId: string): Promise<void> {
  return remove(db, "map_labels", labelId);
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
