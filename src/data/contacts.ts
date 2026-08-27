import { useQuery } from "@powersync/react";
import { db, stamp } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";

// Contacts, and the details that reach them.
//
// The split into two tables is the whole point, not a normalisation habit. A
// contact's NAME is governed by view_owner; their phone, email and address by
// view_contact. Two tables means two sync streams on two permissions, so a
// holder of view_owner but not view_contact never receives a phone number at
// all — the boundary holds on a phone in a dead zone, not merely inside a
// query that could be edited away.
//
// Merging never rewrites the calls, threads or boats pointing at the
// merged-away contact. It sets merged_into_id and every display resolves
// through it, so a merged number still matches its original record on the next
// inbound call.

export interface ContactRow {
  id: string;
  name: string | null;
  merged_into_id: string | null;
  created_at: string;
  /** From contact_details — absent entirely without view_contact. */
  phone: string | null;
  email: string | null;
  address: string | null;
  details_id: string | null;
}

const CONTACT_SELECT = `
  SELECT c.id, c.name, c.merged_into_id, c.created_at,
         d.phone, d.email, d.address, d.id AS details_id
    FROM contacts c
    LEFT JOIN contact_details d ON d.contact_id = c.id`;

export function useContacts() {
  return useQuery<ContactRow>(`${CONTACT_SELECT} ORDER BY c.name`);
}

export function useContact(contactId: string | undefined) {
  const { data, isLoading } = useQuery<ContactRow>(
    `${CONTACT_SELECT} WHERE c.id = ?`,
    [contactId ?? ""],
  );
  return { contact: data[0] ?? null, isLoading };
}

/** Contacts merged INTO this one — shown on the survivor's page. */
export function useMergedContacts(contactId: string | undefined) {
  return useQuery<ContactRow>(
    `${CONTACT_SELECT} WHERE c.merged_into_id = ? ORDER BY c.name`,
    [contactId ?? ""],
  );
}

export interface ContactInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export async function createContact(
  input: ContactInput,
  actorId: string | null,
): Promise<string> {
  return transact(async (tx) => {
    const contactId = await insert(tx, "contacts", {
      name: input.name ?? null,
      created_at: stamp(),
    });
    if (input.phone || input.email || input.address) {
      await insert(tx, "contact_details", {
        contact_id: contactId,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
      });
    }
    await recordActivity(tx, {
      eventType: "contact.created",
      summary: `${input.name?.trim() || "Unnamed contact"} added`,
      subjectType: "contacts",
      subjectId: contactId,
      actorId,
    });
    return contactId;
  });
}

/**
 * Save a contact's name and its details together.
 *
 * The details row is created on demand: a contact with no phone, email or
 * address has no contact_details row at all, so a device without view_contact
 * and a contact who simply has no phone number look the same locally. Both are
 * "no details", and neither should invent an empty row.
 */
export async function saveContact(
  contact: { id: string; details_id: string | null },
  input: ContactInput,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    if (input.name !== undefined) {
      await update(tx, "contacts", contact.id, { name: input.name });
    }
    const details = {
      phone: input.phone,
      email: input.email,
      address: input.address,
    };
    const touchesDetails = Object.values(details).some((v) => v !== undefined);
    if (touchesDetails) {
      if (contact.details_id) {
        await update(tx, "contact_details", contact.details_id, details);
      } else {
        await insert(tx, "contact_details", {
          contact_id: contact.id,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
        });
      }
    }
    await recordActivity(tx, {
      eventType: "contact.updated",
      summary: `${input.name?.trim() || "Contact"} updated`,
      subjectType: "contacts",
      subjectId: contact.id,
      actorId,
    });
  });
}

/** Give a nameless contact a name, without touching their details row. */
export async function renameContact(
  contactId: string,
  name: string,
  phone: string | null,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "contacts", contactId, { name });
    await recordActivity(tx, {
      eventType: "contact.named",
      summary: `Unnamed contact ${phone ?? ""} named "${name}"`.trim(),
      subjectType: "contacts",
      subjectId: contactId,
      actorId,
    });
  });
}

/**
 * Merge one contact into another.
 *
 * Nothing is rewritten and nothing is deleted. The merged-away row keeps every
 * call, thread and boat that ever pointed at it, and gains a pointer to the
 * survivor — so the next inbound call from that number still matches, and
 * resolves through to the right person.
 */
export async function mergeContact(
  loser: { id: string; name: string | null },
  survivor: { id: string; name: string | null },
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "contacts", loser.id, { merged_into_id: survivor.id });
    await recordActivity(tx, {
      eventType: "contact.merged",
      summary: `${loser.name || "Unnamed contact"} merged into ${survivor.name || "unnamed contact"}`,
      subjectType: "contacts",
      subjectId: survivor.id,
      actorId,
    });
  });
}

export function deleteContact(contactId: string): Promise<void> {
  return remove(db, "contacts", contactId);
}

/** A contact's phone as it appears anywhere a number is dialled or matched. */
export function contactPhone(contact: ContactRow | null): string | null {
  return contact?.phone ?? null;
}
