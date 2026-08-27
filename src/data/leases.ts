import { useQuery } from "@powersync/react";
import { db, stamp } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";

// Leases — gated on view_lease, in four tables that all carry the gate.
//
// The lease, its lessees, its documents and its comments are four separate
// streams, each with its own `required_permission` column, because a sync data
// query cannot reach a parent row to ask whether the child is allowed. Each
// child carries its own copy of both the gate and the currency flag; that
// redundancy is the price of scoping being a pure function of one row.

export interface LeaseRow {
  id: string;
  location_id: string | null;
  start_date: string | null;
  end_date: string | null;
  variances_and_conditions: string | null;
  is_current: number;
  location_name: string | null;
  lessee_names: string | null;
}

const LEASE_SELECT = `
  SELECT l.*, loc.name AS location_name,
         (SELECT group_concat(c.name, ', ') FROM lease_lessees ll
            JOIN contacts c ON c.id = ll.contact_id
           WHERE ll.lease_id = l.id) AS lessee_names
    FROM leases l
    LEFT JOIN locations loc ON loc.id = l.location_id`;

export function useLeases() {
  return useQuery<LeaseRow>(`${LEASE_SELECT} ORDER BY l.start_date DESC`);
}

export function useLease(leaseId: string | undefined) {
  const { data, isLoading } = useQuery<LeaseRow>(`${LEASE_SELECT} WHERE l.id = ?`, [
    leaseId ?? "",
  ]);
  return { lease: data[0] ?? null, isLoading };
}

export function useLeasesForContact(contactId: string | undefined) {
  return useQuery<LeaseRow>(
    `${LEASE_SELECT}
       JOIN lease_lessees ll ON ll.lease_id = l.id
      WHERE ll.contact_id = ? ORDER BY l.start_date DESC`,
    [contactId ?? ""],
  );
}

export function useLeasesForLocation(locationId: string | undefined) {
  return useQuery<LeaseRow>(
    `${LEASE_SELECT} WHERE l.location_id = ? ORDER BY l.start_date DESC`,
    [locationId ?? ""],
  );
}

export interface LeaseLesseeRow {
  link_id: string;
  contact_id: string;
  name: string | null;
  phone: string | null;
}

export function useLeaseLessees(leaseId: string | undefined) {
  return useQuery<LeaseLesseeRow>(
    `SELECT ll.id AS link_id, c.id AS contact_id, c.name, d.phone
       FROM lease_lessees ll
       JOIN contacts c ON c.id = ll.contact_id
       LEFT JOIN contact_details d ON d.contact_id = c.id
      WHERE ll.lease_id = ? ORDER BY c.name`,
    [leaseId ?? ""],
  );
}

export interface LeaseCommentRow {
  id: string;
  lease_id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
}

export function useLeaseComments(leaseId: string | undefined) {
  return useQuery<LeaseCommentRow>(
    `SELECT c.*, u.name AS author_name
       FROM lease_comments c
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.lease_id = ? ORDER BY c.created_at`,
    [leaseId ?? ""],
  );
}

export interface LeaseDocumentRow {
  id: string;
  lease_id: string;
  attachment_id: string;
  storage_path: string | null;
  content_type: string | null;
  upload_state: string | null;
}

export function useLeaseDocuments(leaseId: string | undefined) {
  return useQuery<LeaseDocumentRow>(
    `SELECT ld.*, a.storage_path, a.content_type, a.upload_state
       FROM lease_documents ld
       LEFT JOIN attachments a ON a.id = ld.attachment_id
      WHERE ld.lease_id = ?`,
    [leaseId ?? ""],
  );
}

export interface LeaseInput {
  locationId: string | null;
  startDate: string | null;
  endDate: string | null;
  variancesAndConditions?: string | null;
}

function leaseColumns(input: Partial<LeaseInput>) {
  return {
    location_id: input.locationId === undefined ? undefined : input.locationId,
    start_date: input.startDate === undefined ? undefined : input.startDate,
    end_date: input.endDate === undefined ? undefined : input.endDate,
    variances_and_conditions:
      input.variancesAndConditions === undefined
        ? undefined
        : input.variancesAndConditions,
  };
}

export async function createLease(
  input: LeaseInput,
  lesseeIds: string[],
  locationName: string,
  actorId: string | null,
): Promise<string> {
  return transact(async (tx) => {
    const leaseId = await insert(tx, "leases", leaseColumns(input));
    for (const contactId of lesseeIds) {
      await insert(tx, "lease_lessees", { lease_id: leaseId, contact_id: contactId });
    }
    await recordActivity(tx, {
      eventType: "lease.created",
      summary: `Lease created on ${locationName}`,
      subjectType: "leases",
      subjectId: leaseId,
      actorId,
    });
    return leaseId;
  });
}

export async function saveLease(
  leaseId: string,
  input: Partial<LeaseInput>,
  locationName: string,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "leases", leaseId, leaseColumns(input));
    await recordActivity(tx, {
      eventType: "lease.updated",
      summary: `Lease on ${locationName} updated`,
      subjectType: "leases",
      subjectId: leaseId,
      actorId,
    });
  });
}

export function addLessee(leaseId: string, contactId: string): Promise<string> {
  return insert(db, "lease_lessees", { lease_id: leaseId, contact_id: contactId });
}

export function removeLessee(linkId: string): Promise<void> {
  return remove(db, "lease_lessees", linkId);
}

export function addLeaseDocument(
  leaseId: string,
  attachmentId: string,
): Promise<string> {
  return insert(db, "lease_documents", {
    lease_id: leaseId,
    attachment_id: attachmentId,
  });
}

export function removeLeaseDocument(documentId: string): Promise<void> {
  return remove(db, "lease_documents", documentId);
}

export function addLeaseComment(
  leaseId: string,
  body: string,
  actorId: string | null,
): Promise<string> {
  return insert(db, "lease_comments", {
    lease_id: leaseId,
    body,
    created_at: stamp(),
    author_id: actorId,
  });
}

/**
 * Delete a lease.
 *
 * Its lessee links, documents and comments cascade — a lease's comments are
 * about the lease and mean nothing without it. Nothing else does: the contacts
 * and the location survive, which is why those are FKs out of the lease rather
 * than into it.
 */
export function deleteLease(leaseId: string): Promise<void> {
  return remove(db, "leases", leaseId);
}
