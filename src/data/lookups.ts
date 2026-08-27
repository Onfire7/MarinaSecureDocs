import { useQuery } from "@powersync/react";
import { db, bool } from "../lib/db";
import { insert, remove, update } from "./sql";
import { statusKey } from "../lib/locations";

// The admin-defined lookup tables: statuses and types.
//
// These were fixed strings on entity rows under InstantDB, and are now rows a
// marina can add to. Two consequences run through the whole client:
//
//   * A status has a display NAME, so nothing title-cases it any more.
//   * A status has an ID, so anything storing one stores a uuid. Code that
//     compared `status === "vacant"` now compares against a resolved row, or
//     against statusKey(name) where it only wants the colour.
//
// A marina that has not finished setup has few or none of these — this one
// currently has one location status and no incident types at all — so every
// consumer has to read sensibly against an empty table rather than assume.

export interface StatusRow {
  id: string;
  name: string;
  position: number;
}

export interface TerminalStatusRow extends StatusRow {
  /** True for the status that means "finished" — Complete, Closed. */
  is_terminal: number;
}

export interface LocationStatusRow extends StatusRow {
  /** True for the statuses that mean the location is available. */
  is_vacancy: number;
}

export interface TypeRow {
  id: string;
  name: string;
}

/**
 * The status a reservation-enabled location returns to on check-out, when it
 * has no per-location override.
 *
 * A NAME rather than an id, because ids differ per marina and this is a
 * default in code. Resolved against the marina's own rows by
 * {@link resolveStatusByName}, which returns null when the marina has not
 * created it — a null the caller must handle rather than invent a row for.
 */
export const DEFAULT_POST_RESERVATION_STATUS = "Needs Cleaning";

export function resolveStatusByName<T extends { id: string; name: string }>(
  statuses: T[],
  name: string,
): T | null {
  const key = statusKey(name);
  return statuses.find((s) => statusKey(s.name) === key) ?? null;
}

export function useTicketStatuses() {
  const { data, isLoading } = useQuery<TerminalStatusRow>(
    "SELECT * FROM ticket_statuses ORDER BY position, name",
  );
  return { isLoading, statuses: data };
}

export function useIncidentStatuses() {
  const { data, isLoading } = useQuery<TerminalStatusRow>(
    "SELECT * FROM incident_statuses ORDER BY position, name",
  );
  return { isLoading, statuses: data };
}

export function useIncidentTypes() {
  const { data, isLoading } = useQuery<TypeRow>(
    "SELECT * FROM incident_types ORDER BY name",
  );
  return { isLoading, types: data };
}

export function useLocationStatuses() {
  const { data, isLoading } = useQuery<LocationStatusRow>(
    "SELECT * FROM location_statuses ORDER BY position, name",
  );
  return { isLoading, statuses: data };
}

export function useAssetStatuses() {
  const { data, isLoading } = useQuery<StatusRow>(
    "SELECT * FROM asset_statuses ORDER BY position, name",
  );
  return { isLoading, statuses: data };
}

/** Whether a terminal-flagged status means the work is done. */
export function isTerminal(status: { is_terminal: number } | null | undefined): boolean {
  return bool(status?.is_terminal);
}

export function isVacancy(status: { is_vacancy: number } | null | undefined): boolean {
  return bool(status?.is_vacancy);
}

/** Look up by id in a list, for rendering a stored status_id. */
export function byId<T extends { id: string }>(
  rows: T[],
  rowId: string | null | undefined,
): T | null {
  if (!rowId) return null;
  return rows.find((r) => r.id === rowId) ?? null;
}

// ---------------------------------------------------------------- editing

export function createIncidentType(name: string): Promise<string> {
  return insert(db, "incident_types", { name });
}

export function renameIncidentType(typeId: string, name: string): Promise<void> {
  return update(db, "incident_types", typeId, { name });
}

export function deleteIncidentType(typeId: string) {
  return remove(db, "incident_types", typeId);
}

export type StatusTable =
  | "ticket_statuses"
  | "incident_statuses"
  | "location_statuses"
  | "asset_statuses";

export async function saveStatus(
  table: StatusTable,
  row: {
    id?: string;
    name: string;
    position: number;
    isTerminal?: boolean;
    isVacancy?: boolean;
  },
): Promise<string> {
  const columns = {
    name: row.name,
    position: row.position,
    is_terminal: row.isTerminal === undefined ? undefined : row.isTerminal ? 1 : 0,
    is_vacancy: row.isVacancy === undefined ? undefined : row.isVacancy ? 1 : 0,
  };
  if (!row.id) return insert(db, table, columns);
  await update(db, table, row.id, columns);
  return row.id;
}

export function deleteStatus(table: StatusTable, statusId: string): Promise<void> {
  return remove(db, table, statusId);
}
