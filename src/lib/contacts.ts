// Contacts — merge resolution and duplicate detection (see docs:
// pages/nameless-contact-merge.html, pages/contact-detail.html).
//
// Merging never rewrites the Call/SMSThread/Boat references pointing at a
// merged-away Contact; it sets `mergedInto` and every display resolves
// through it to the canonical record. That keeps a merged number still
// matching its original record on the next inbound call.

export interface ContactLike {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  mergedInto?: { id: string } | null;
}

/** Follow the mergedInto chain to the canonical record. */
export function resolveContact<T extends ContactLike>(
  contact: T,
  byId: Map<string, T>,
): T {
  let cursor = contact;
  const seen = new Set<string>([contact.id]);
  while (cursor.mergedInto?.id) {
    const next = byId.get(cursor.mergedInto.id);
    // Stop on a missing target or a cycle rather than looping forever.
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    cursor = next;
  }
  return cursor;
}

export function isNameless(contact: ContactLike): boolean {
  return !contact.name || contact.name.trim() === "";
}

export function displayName(contact: ContactLike): string {
  return isNameless(contact) ? "Unnamed contact" : contact.name!.trim();
}

// Normalized digits, so "(555) 123-4567" and "555-123-4567" compare equal.
export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * Candidate duplicates for a name being typed into the nameless-contact
 * prompt: case-insensitive substring either direction, plus any exact
 * phone match regardless of name.
 */
export function findSimilarContacts<T extends ContactLike>(
  name: string,
  self: ContactLike,
  all: T[],
): T[] {
  const needle = name.trim().toLowerCase();
  const selfPhone = normalizePhone(self.phone);
  return all.filter((c) => {
    if (c.id === self.id || c.mergedInto?.id) return false;
    if (selfPhone && normalizePhone(c.phone) === selfPhone) return true;
    if (needle.length < 2 || !c.name) return false;
    const other = c.name.trim().toLowerCase();
    return other.includes(needle) || needle.includes(other);
  });
}
