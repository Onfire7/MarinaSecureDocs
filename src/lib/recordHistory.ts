// Ticket Updates and Incident Updates, the pure half (TicketDetailPage.spec.md
// § Ticket Updates, IncidentDetailPage.spec.md § The timeline, ADR 0008).
// Rows are described as catalog keys with values, so a page says them in the
// user's language and this stays unit-testable.

export type TicketUpdateKind = "created" | "status" | "priority" | "assignee" | "comment";
export type IncidentUpdateKind = "status" | "assignee";

export interface UpdateLike {
  id: string;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  body?: string | null;
  created_at: string;
  author_name: string | null;
}

export interface AddendumLike {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
}

export type TimelineEntry =
  | { kind: "update"; at: string; row: UpdateLike }
  | { kind: "addendum"; at: string; row: AddendumLike };

/**
 * Addenda and Updates in one list, oldest first. Equal moments keep their
 * input order, addenda before updates, so a status change made as a comment
 * is posted reads in the order it happened on the page.
 */
export function mergeTimeline(addenda: AddendumLike[], updates: UpdateLike[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...addenda.map((row): TimelineEntry => ({ kind: "addendum", at: row.created_at, row })),
    ...updates.map((row): TimelineEntry => ({ kind: "update", at: row.created_at, row })),
  ];
  // Array.prototype.sort is stable, which is what keeps equal moments in
  // input order.
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The catalog key (under `timeline.`) and values that say what an Update was. */
export function describeUpdate(row: UpdateLike): { key: string; values: Record<string, string> } {
  const name = row.author_name ?? "";
  switch (row.kind) {
    case "created":
      return row.to_value
        ? { key: "timeline.createdVia", values: { name, origin: row.to_value } }
        : { key: "timeline.created", values: { name } };
    case "status":
      return { key: "timeline.status", values: { from: row.from_value ?? "", to: row.to_value ?? "" } };
    case "priority":
      return { key: "timeline.priority", values: { from: row.from_value ?? "", to: row.to_value ?? "" } };
    case "assignee":
      return { key: "timeline.assignee", values: { to: row.to_value ?? "" } };
    case "comment":
      return { key: "timeline.comment", values: { body: row.body ?? "" } };
    default:
      return { key: "timeline.unknown", values: { kind: row.kind } };
  }
}

/**
 * Whether choosing `next` changes anything. A change that changes nothing is
 * not written: no Update, no Activity Log entry.
 */
export function isChange(current: string | null | undefined, next: string | null | undefined): boolean {
  return (current ?? null) !== (next ?? null);
}
