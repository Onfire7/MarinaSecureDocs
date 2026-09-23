import { useQuery } from "@powersync/react";
import { db, jsonArray, stamp } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { rankNoteSuggestions } from "../lib/audits";

// Services, Amenities and Attributes — what a Location provides, and what
// it will accept (docs/audits.md § Services and Amenities, ADR 0007).
//
// Three marina-defined catalogues, each entry valid for chosen Location
// Types. Services and Amenities are presence: a row means "here". An
// Attribute is a number the location enforces — maximum boat length,
// maximum vehicle length — so its row carries a value, not just presence.
// Services and Amenities can change from the admin editor or an approved
// audit Proposal; an Attribute value only ever changes through a Proposal
// once an audit exists, because a capacity limit is worth a second look —
// the admin editor still writes it directly, with no audit involved.

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
export type AttributeKind = "number" | "choice";
export interface AttributeRow {
  id: string;
  name: string;
  /** `number` carries a unit; `choice` carries options. */
  kind: AttributeKind;
  unit: string | null;
  /** JSON-encoded text[] on the device — use {@link attributeChoices}. */
  choices: string | null;
  position: number;
}

/** A choice Attribute's options, off the device's text[] column. */
export function attributeChoices(row: { choices: string | null }): string[] {
  return jsonArray(row.choices);
}
export interface ValidityRow {
  id: string;
  location_type_id: string;
  service_id?: string;
  amenity_id?: string;
  attribute_id?: string;
}

export function useServices() {
  return useQuery<ServiceRow>("SELECT * FROM services ORDER BY position, name");
}
export function useAmenities() {
  return useQuery<AmenityRow>("SELECT * FROM amenities ORDER BY position, name");
}
export function useAttributes() {
  return useQuery<AttributeRow>("SELECT * FROM attributes ORDER BY position, name");
}
export function useServiceValidity() {
  return useQuery<ValidityRow>("SELECT * FROM service_location_types");
}
export function useAmenityValidity() {
  return useQuery<ValidityRow>("SELECT * FROM amenity_location_types");
}
export function useAttributeValidity() {
  return useQuery<ValidityRow>("SELECT * FROM attribute_location_types");
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
export function createAttribute(input: {
  name: string;
  kind?: AttributeKind;
  unit?: string | null;
}): Promise<string> {
  return insert(db, "attributes", {
    name: input.name,
    kind: input.kind ?? "number",
    unit: input.unit ?? null,
    choices: JSON.stringify([]),
    position: 0,
  });
}
export function saveAttribute(
  id: string,
  input: { name?: string; kind?: AttributeKind; unit?: string | null; choices?: string[] },
): Promise<void> {
  return update(db, "attributes", id, {
    name: input.name,
    kind: input.kind,
    unit: input.unit,
    choices: input.choices === undefined ? undefined : JSON.stringify(input.choices),
  });
}
export function deleteAttribute(id: string): Promise<void> {
  return remove(db, "attributes", id);
}

/** Replace the set of types a catalogue entry is valid for. */
export async function setValidTypes(
  kind: "service" | "amenity" | "attribute",
  entryId: string,
  typeIds: string[],
): Promise<void> {
  const table =
    kind === "service"
      ? "service_location_types"
      : kind === "amenity"
        ? "amenity_location_types"
        : "attribute_location_types";
  const column = kind === "service" ? "service_id" : kind === "amenity" ? "amenity_id" : "attribute_id";
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
export interface LocationAttributeRow {
  id: string;
  location_id: string;
  attribute_id: string;
  /** Set for a `number` Attribute; null for a `choice` one. */
  value: number | null;
  /** Set for a `choice` Attribute; null for a `number` one. */
  value_text: string | null;
  note: string | null;
  attribute_name: string;
  attribute_kind: AttributeKind;
  unit: string | null;
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
export function useLocationAttributes(locationId: string | undefined) {
  return useQuery<LocationAttributeRow>(
    `SELECT la.*, at.name AS attribute_name, at.kind AS attribute_kind, at.unit
       FROM location_attributes la JOIN attributes at ON at.id = la.attribute_id
      WHERE la.location_id = ? ORDER BY at.position, at.name`,
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
 * Direct edit only — from the admin location editor, holding
 * manage_locations. An Attribute value never changes this way from a
 * Finding once an audit exists for the location; that path always goes
 * through a set_attribute Proposal (see docs/audits.md).
 */
/**
 * An Attribute is always applicable to a Location of a valid type — there
 * is nothing to turn on or off — so this is the one function that sets it:
 * a null value clears it (deletes the row); any other value creates or
 * updates it. Direct edit only, from the admin location editor. Once an
 * audit exists for the Location, a value changes only through an approved
 * set_attribute Proposal (see docs/audits.md).
 */
export function saveLocationAttributeValue(
  locationId: string,
  attributeId: string,
  value: { value: number | null; text: string | null },
  note?: string | null,
): Promise<void> {
  return transact(async (tx) => {
    await tx.execute("DELETE FROM location_attributes WHERE location_id = ? AND attribute_id = ?", [
      locationId,
      attributeId,
    ]);
    if (value.value !== null || value.text !== null) {
      await insert(tx, "location_attributes", {
        location_id: locationId,
        attribute_id: attributeId,
        value: value.value,
        value_text: value.text,
        note: note ?? null,
      });
    }
  });
}

/**
 * Note suggestions for one catalogue entry: the distinct notes already in
 * use across locations, most-used first. A query, not a table.
 */
export function useNoteSuggestions(
  kind: "service" | "amenity" | "attribute",
  entryId: string | undefined,
) {
  const table =
    kind === "service" ? "location_services" : kind === "amenity" ? "location_amenities" : "location_attributes";
  const column = kind === "service" ? "service_id" : kind === "amenity" ? "amenity_id" : "attribute_id";
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
