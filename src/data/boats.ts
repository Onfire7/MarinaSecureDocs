import { useQuery } from "@powersync/react";
import { db } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";

// Boats and vehicles, and the contacts attached to them.
//
// Occupancy-scoped: a device holds what is physically at the marina, plus a
// 30-day trailing window so a follow-up on last week's departed guest still
// works with no signal. is_resident is maintained by refresh_sync_scopes(), not
// by anything here — a boat does not become non-resident because the client
// says so.

export interface BoatRow {
  id: string;
  name: string;
  description: string | null;
  length: number | null;
  make: string | null;
  model: string | null;
  registration_number: string | null;
  /** The slip it currently sits in, if any. */
  location_id: string | null;
  location_name: string | null;
  owner_names: string | null;
}

const BOAT_SELECT = `
  SELECT b.*,
         l.id AS location_id, l.name AS location_name,
         (SELECT group_concat(c.name, ', ') FROM boat_owners bo
            JOIN contacts c ON c.id = bo.contact_id
           WHERE bo.boat_id = b.id) AS owner_names
    FROM boats b
    LEFT JOIN locations l ON l.current_boat_id = b.id`;

export function useBoats() {
  return useQuery<BoatRow>(`${BOAT_SELECT} ORDER BY b.name`);
}

export function useBoat(boatId: string | undefined) {
  const { data, isLoading } = useQuery<BoatRow>(`${BOAT_SELECT} WHERE b.id = ?`, [
    boatId ?? "",
  ]);
  return { boat: data[0] ?? null, isLoading };
}

export interface VehicleRow {
  id: string;
  description: string;
  plate_number: string | null;
  location_id: string | null;
  location_name: string | null;
  owner_names: string | null;
}

const VEHICLE_SELECT = `
  SELECT v.*,
         l.id AS location_id, l.name AS location_name,
         (SELECT group_concat(c.name, ', ') FROM vehicle_owners vo
            JOIN contacts c ON c.id = vo.contact_id
           WHERE vo.vehicle_id = v.id) AS owner_names
    FROM vehicles v
    LEFT JOIN locations l ON l.current_vehicle_id = v.id`;

export function useVehicles() {
  return useQuery<VehicleRow>(`${VEHICLE_SELECT} ORDER BY v.description`);
}

export function useVehicle(vehicleId: string | undefined) {
  const { data, isLoading } = useQuery<VehicleRow>(
    `${VEHICLE_SELECT} WHERE v.id = ?`,
    [vehicleId ?? ""],
  );
  return { vehicle: data[0] ?? null, isLoading };
}

/**
 * The people attached to a boat or vehicle.
 *
 * Owners are ordered; authorised users are not. `position` is what makes "the
 * primary owner" a fact rather than a rendering accident, and it is why owners
 * carry one and authorised users do not.
 */
export interface AttachedContactRow {
  link_id: string;
  contact_id: string;
  name: string | null;
  phone: string | null;
  position: number | null;
}

export function useBoatOwners(boatId: string | undefined) {
  return useQuery<AttachedContactRow>(
    `SELECT bo.id AS link_id, c.id AS contact_id, c.name, d.phone, bo.position
       FROM boat_owners bo
       JOIN contacts c ON c.id = bo.contact_id
       LEFT JOIN contact_details d ON d.contact_id = c.id
      WHERE bo.boat_id = ? ORDER BY bo.position`,
    [boatId ?? ""],
  );
}

export function useBoatAuthorizedUsers(boatId: string | undefined) {
  return useQuery<AttachedContactRow>(
    `SELECT ba.id AS link_id, c.id AS contact_id, c.name, d.phone, NULL AS position
       FROM boat_authorized_users ba
       JOIN contacts c ON c.id = ba.contact_id
       LEFT JOIN contact_details d ON d.contact_id = c.id
      WHERE ba.boat_id = ? ORDER BY c.name`,
    [boatId ?? ""],
  );
}

export function useVehicleOwners(vehicleId: string | undefined) {
  return useQuery<AttachedContactRow>(
    `SELECT vo.id AS link_id, c.id AS contact_id, c.name, d.phone, vo.position
       FROM vehicle_owners vo
       JOIN contacts c ON c.id = vo.contact_id
       LEFT JOIN contact_details d ON d.contact_id = c.id
      WHERE vo.vehicle_id = ? ORDER BY vo.position`,
    [vehicleId ?? ""],
  );
}

/** Boats and vehicles a contact is attached to, in either capacity. */
export function useContactCraft(contactId: string | undefined) {
  return useQuery<{
    id: string;
    label: string;
    kind: "boat" | "vehicle";
    role: string;
  }>(
    `SELECT b.id, b.name AS label, 'boat' AS kind, 'Owner' AS role
       FROM boat_owners bo JOIN boats b ON b.id = bo.boat_id
      WHERE bo.contact_id = ?
     UNION ALL
     SELECT b.id, b.name AS label, 'boat' AS kind, 'Authorized' AS role
       FROM boat_authorized_users ba JOIN boats b ON b.id = ba.boat_id
      WHERE ba.contact_id = ?
     UNION ALL
     SELECT v.id, v.description AS label, 'vehicle' AS kind, 'Owner' AS role
       FROM vehicle_owners vo JOIN vehicles v ON v.id = vo.vehicle_id
      WHERE vo.contact_id = ?
     ORDER BY kind, label`,
    [contactId ?? "", contactId ?? "", contactId ?? ""],
  );
}

export interface BoatInput {
  name: string;
  description?: string | null;
  length?: number | null;
  make?: string | null;
  model?: string | null;
  registrationNumber?: string | null;
}

function boatColumns(input: Partial<BoatInput>) {
  return {
    name: input.name,
    description: input.description === undefined ? undefined : input.description,
    length: input.length === undefined ? undefined : input.length,
    make: input.make === undefined ? undefined : input.make,
    model: input.model === undefined ? undefined : input.model,
    registration_number:
      input.registrationNumber === undefined ? undefined : input.registrationNumber,
  };
}

export function createBoat(input: BoatInput): Promise<string> {
  return insert(db, "boats", boatColumns(input));
}

export function saveBoat(boatId: string, input: Partial<BoatInput>): Promise<void> {
  return update(db, "boats", boatId, boatColumns(input));
}

export function createVehicle(input: {
  description: string;
  plateNumber?: string | null;
}): Promise<string> {
  return insert(db, "vehicles", {
    description: input.description,
    plate_number: input.plateNumber ?? null,
  });
}

export function saveVehicle(
  vehicleId: string,
  input: { description?: string; plateNumber?: string | null },
): Promise<void> {
  return update(db, "vehicles", vehicleId, {
    description: input.description,
    plate_number: input.plateNumber,
  });
}

/**
 * Move a boat to a slip, or out of the water entirely.
 *
 * Where a boat is lives on the LOCATION (locations.current_boat_id), not on
 * the boat — so a move is two writes, and the old slip has to be cleared or
 * the same boat appears in two places. The move itself is recorded only in the
 * activity log: there is no boat-location history table, deliberately, because
 * the log is the history and it already outlives the rows it describes.
 */
export async function moveBoat(
  boat: { id: string; name: string },
  from: { name: string } | null,
  to: { id: string; name: string } | null,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await tx.execute(
      "UPDATE locations SET current_boat_id = NULL WHERE current_boat_id = ?",
      [boat.id],
    );
    if (to) await update(tx, "locations", to.id, { current_boat_id: boat.id });
    await recordActivity(tx, {
      eventType: to ? "boat.slip_changed" : "boat.departed",
      summary: to
        ? `${boat.name} moved${from ? ` from ${from.name}` : ""} to ${to.name}`
        : `${boat.name} left ${from?.name ?? "its slip"}`,
      subjectType: "boats",
      subjectId: boat.id,
      actorId,
    });
  });
}

/**
 * Haul a boat out — it leaves the water rather than moving between slips.
 *
 * A marina haul-out also raises a ticket for the work, in the same transaction:
 * the boat being out and the job to do it are one event, and a device that goes
 * flat between two separate writes would record the first without the second.
 */
export async function haulOutBoat(
  boat: { id: string; name: string },
  from: { id: string; name: string },
  byMarina: boolean,
  ticketStatusId: string | null,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "locations", from.id, { current_boat_id: null });
    await recordActivity(tx, {
      eventType: "boat.hauled_out",
      summary:
        `${boat.name} hauled out of ${from.name} ` +
        `(${byMarina ? "marina haul-out" : "customer haul-out"})`,
      subjectType: "boats",
      subjectId: boat.id,
      actorId,
    });
    if (byMarina && ticketStatusId) {
      await insert(tx, "tickets", {
        title: `Haul out ${boat.name}`,
        description: `Marina haul-out from ${from.name}.`,
        priority: "medium",
        status_id: ticketStatusId,
        auto_generated: 0,
        created_at: new Date().toISOString(),
        created_by_id: actorId,
        boat_id: boat.id,
      });
    }
  });
}

export async function moveVehicle(
  vehicle: { id: string; description: string },
  from: { name: string } | null,
  to: { id: string; name: string } | null,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await tx.execute(
      "UPDATE locations SET current_vehicle_id = NULL WHERE current_vehicle_id = ?",
      [vehicle.id],
    );
    if (to) await update(tx, "locations", to.id, { current_vehicle_id: vehicle.id });
    await recordActivity(tx, {
      eventType: to ? "vehicle.location_changed" : "vehicle.departed",
      summary: to
        ? `${vehicle.description} moved to ${to.name}`
        : `${vehicle.description} departed ${from?.name ?? "its location"}`,
      subjectType: "vehicles",
      subjectId: vehicle.id,
      actorId,
    });
  });
}

export function addBoatOwner(
  boatId: string,
  contactId: string,
  position: number,
): Promise<string> {
  return insert(db, "boat_owners", {
    boat_id: boatId,
    contact_id: contactId,
    position,
  });
}

export function addBoatAuthorizedUser(
  boatId: string,
  contactId: string,
): Promise<string> {
  return insert(db, "boat_authorized_users", {
    boat_id: boatId,
    contact_id: contactId,
  });
}

export function addVehicleOwner(
  vehicleId: string,
  contactId: string,
  position: number,
): Promise<string> {
  return insert(db, "vehicle_owners", {
    vehicle_id: vehicleId,
    contact_id: contactId,
    position,
  });
}

export function removeAttachedContact(
  table: "boat_owners" | "boat_authorized_users" | "vehicle_owners",
  linkId: string,
): Promise<void> {
  return remove(db, table, linkId);
}

/** Rewrite owner order after a drag. */
export async function reorderOwners(
  table: "boat_owners" | "vehicle_owners",
  linkIds: string[],
): Promise<void> {
  await transact(async (tx) => {
    for (const [position, linkId] of linkIds.entries()) {
      await update(tx, table, linkId, { position });
    }
  });
}
