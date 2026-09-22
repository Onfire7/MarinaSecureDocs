import { useQuery } from "@powersync/react";
import { db, stamp } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { rankNoteSuggestions } from "../lib/audits";

// Services and Amenities — what a Location provides (docs/audits.md
// § Services and Amenities, ADR 0007).
//
// Two marina-defined catalogues, each entry valid for chosen Location Types.
// Per location a row means "present"; a Service row also says whether it
// works and whether it is metered. Presence changes here (the admin editor)
// or through an approved audit Proposal — never straight from a Finding.

export interface ServiceRow {
  id: string;
  name: string;
  unit: string | null;
  position: number;
}
export interface AmenityRow {
  id: string;
  name: string;
  position: number;
}
export interface ValidityRow {
  id: string;
  location_type_id: string;
  service_id?: string;
  amenity_id?: string;
}

export function useServices() {
  return useQuery<ServiceRow>("SELECT * FROM services ORDER BY position, name");
}
export function useAmenities() {
  return useQuery<AmenityRow>("SELECT * FROM amenities ORDER BY position, name");
}
export function useServiceValidity() {
  return useQuery<ValidityRow>("SELECT * FROM service_location_types");
}
export function useAmenityValidity() {
  return useQuery<ValidityRow>("SELECT * FROM amenity_location_types");
}

export function createService(input: { name: string; unit?: string | null }): Promise<string> {
  return insert(db, "services", { name: input.name, unit: input.unit ?? null, position: 0 });
}
export function saveService(id: string, input: { name?: string; unit?: string | null }): Promise<void> {
  return update(db, "services", id, { name: input.name, unit: input.unit });
}
export function deleteService(id: string): Promise<void> {
  return remove(db, "services", id);
}
export function createAmenity(input: { name: string }): Promise<string> {
  return insert(db, "amenities", { name: input.name, position: 0 });
}
export function saveAmenity(id: string, input: { name?: string }): Promise<void> {
  return update(db, "amenities", id, { name: input.name });
}
export function deleteAmenity(id: string): Promise<void> {
  return remove(db, "amenities", id);
}

/** Replace the set of types a catalogue entry is valid for. */
export async function setValidTypes(
  kind: "service" | "amenity",
  entryId: string,
  typeIds: string[],
): Promise<void> {
  const table = kind === "service" ? "service_location_types" : "amenity_location_types";
  const column = kind === "service" ? "service_id" : "amenity_id";
  await transact(async (tx) => {
    await tx.execute(`DELETE FROM ${table} WHERE ${column} = ?`, [entryId]);
    for (const typeId of typeIds) {
      await insert(tx, table, { [column]: entryId, location_type_id: typeId });
    }
  });
}

// ── per location ─────────────────────────────────────────────────────────

export interface LocationServiceRow {
  id: string;
  location_id: string;
  service_id: string;
  working: number;
  metered: number;
  note: string | null;
  service_name: string;
  unit: string | null;
}
export interface LocationAmenityRow {
  id: string;
  location_id: string;
  amenity_id: string;
  note: string | null;
  amenity_name: string;
}

export function useLocationServices(locationId: string | undefined) {
  return useQuery<LocationServiceRow>(
    `SELECT ls.*, s.name AS service_name, s.unit
       FROM location_services ls JOIN services s ON s.id = ls.service_id
      WHERE ls.location_id = ? ORDER BY s.position, s.name`,
    [locationId ?? ""],
  );
}
export function useLocationAmenities(locationId: string | undefined) {
  return useQuery<LocationAmenityRow>(
    `SELECT la.*, a.name AS amenity_name
       FROM location_amenities la JOIN amenities a ON a.id = la.amenity_id
      WHERE la.location_id = ? ORDER BY a.position, a.name`,
    [locationId ?? ""],
  );
}

/** Every location's services and amenities at once, for rule evaluation. */
export function useAllLocationServices() {
  return useQuery<{ location_id: string; service_id: string }>(
    "SELECT location_id, service_id FROM location_services",
  );
}
export function useAllLocationAmenities() {
  return useQuery<{ location_id: string; amenity_id: string }>(
    "SELECT location_id, amenity_id FROM location_amenities",
  );
}

export function setLocationServicePresent(
  locationId: string,
  serviceId: string,
  present: boolean,
): Promise<void> {
  return transact(async (tx) => {
    await tx.execute("DELETE FROM location_services WHERE location_id = ? AND service_id = ?", [
      locationId,
      serviceId,
    ]);
    if (present) {
      await insert(tx, "location_services", {
        location_id: locationId,
        service_id: serviceId,
        working: 1,
        metered: 0,
        note: null,
      });
    }
  });
}
export function saveLocationService(
  rowId: string,
  changes: { working?: boolean; metered?: boolean; note?: string | null },
): Promise<void> {
  return update(db, "location_services", rowId, {
    working: changes.working === undefined ? undefined : changes.working ? 1 : 0,
    metered: changes.metered === undefined ? undefined : changes.metered ? 1 : 0,
    note: changes.note,
  });
}
export function setLocationAmenityPresent(
  locationId: string,
  amenityId: string,
  present: boolean,
): Promise<void> {
  return transact(async (tx) => {
    await tx.execute("DELETE FROM location_amenities WHERE location_id = ? AND amenity_id = ?", [
      locationId,
      amenityId,
    ]);
    if (present) {
      await insert(tx, "location_amenities", { location_id: locationId, amenity_id: amenityId, note: null });
    }
  });
}
export function saveLocationAmenity(rowId: string, changes: { note?: string | null }): Promise<void> {
  return update(db, "location_amenities", rowId, { note: changes.note });
}

/**
 * Note suggestions for one catalogue entry: the distinct notes already in
 * use across locations, most-used first. A query, not a table.
 */
export function useNoteSuggestions(kind: "service" | "amenity", entryId: string | undefined) {
  const table = kind === "service" ? "location_services" : "location_amenities";
  const column = kind === "service" ? "service_id" : "amenity_id";
  const { data } = useQuery<{ note: string | null }>(
    `SELECT note FROM ${table} WHERE ${column} = ? AND note IS NOT NULL AND note <> ''`,
    [entryId ?? ""],
  );
  return rankNoteSuggestions(data.map((r) => r.note));
}

// ── meter readings ───────────────────────────────────────────────────────

export interface MeterReadingRow {
  id: string;
  location_service_id: string;
  value: number;
  read_at: string;
  read_by_id: string | null;
  reset: number;
}

export function useMeterReadings(locationServiceId: string | undefined) {
  return useQuery<MeterReadingRow>(
    "SELECT * FROM service_meter_readings WHERE location_service_id = ? ORDER BY read_at DESC",
    [locationServiceId ?? ""],
  );
}

export function recordMeterReading(input: {
  locationServiceId: string;
  value: number;
  reset?: boolean;
  readById: string | null;
  sourceFindingId?: string | null;
}): Promise<string> {
  return insert(db, "service_meter_readings", {
    location_service_id: input.locationServiceId,
    value: input.value,
    read_at: stamp(),
    read_by_id: input.readById,
    reset: input.reset ? 1 : 0,
    source_finding_id: input.sourceFindingId ?? null,
  });
}
