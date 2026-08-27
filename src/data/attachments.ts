import { useQuery } from "@powersync/react";

// Attachment targets, resolved in SQL.
//
// Every note, incident and ticket attaches to exactly one of six things — a
// location, checkpoint, boat, vehicle, contact or asset — modelled as six
// nullable columns with `num_nonnulls(...) = 1` holding the "exactly one"
// down. The client needs three facts about that target: which kind it is,
// which row, and what to call it.
//
// All three are computed in the query rather than in JavaScript. The label
// lives on the target's own row, so resolving it in TypeScript would mean a
// second query per list — 200 tickets, 200 lookups. The joins below cost
// nothing on an indexed local SQLite and collapse it to one.

export const TARGET_TYPES = [
  { key: "location", label: "Location", column: "location_id" },
  { key: "checkpoint", label: "Checkpoint", column: "checkpoint_id" },
  { key: "boat", label: "Boat", column: "boat_id" },
  { key: "vehicle", label: "Vehicle", column: "vehicle_id" },
  { key: "contact", label: "Contact", column: "contact_id" },
  { key: "asset", label: "Asset", column: "asset_id" },
] as const;

export type TargetType = (typeof TARGET_TYPES)[number]["key"];

export interface AttachmentTarget {
  type: TargetType;
  id: string;
  label: string;
}

/** The three target columns every attachable query selects. */
export interface AttachedRow {
  target_type: TargetType | null;
  target_id: string | null;
  target_label: string | null;
}

/**
 * SELECT fragment resolving the target of an attachable row aliased `t`.
 *
 * Pair with {@link attachmentJoins} using the same alias — separately they
 * are both valid SQL and together they are wrong, which is the one way to
 * misuse this.
 */
export function attachmentSelect(t: string): string {
  return `
    CASE
      WHEN ${t}.location_id   IS NOT NULL THEN 'location'
      WHEN ${t}.checkpoint_id IS NOT NULL THEN 'checkpoint'
      WHEN ${t}.boat_id       IS NOT NULL THEN 'boat'
      WHEN ${t}.vehicle_id    IS NOT NULL THEN 'vehicle'
      WHEN ${t}.contact_id    IS NOT NULL THEN 'contact'
      WHEN ${t}.asset_id      IS NOT NULL THEN 'asset'
    END AS target_type,
    COALESCE(${t}.location_id, ${t}.checkpoint_id, ${t}.boat_id,
             ${t}.vehicle_id, ${t}.contact_id, ${t}.asset_id) AS target_id,
    COALESCE(${t}_tl.name, ${t}_tcp.name, ${t}_tb.name,
             ${t}_tv.description, ${t}_tc.name, ${t}_ta.name) AS target_label`;
}

/**
 * The LEFT JOINs {@link attachmentSelect} reads from.
 *
 * Left joins, not inner: a contact can fall out of the occupancy window while
 * the ticket about them stays open, and the target simply has no label on this
 * device. An inner join would make the ticket itself disappear — losing the
 * work item rather than the name on it.
 */
export function attachmentJoins(t: string): string {
  return `
    LEFT JOIN locations   ${t}_tl  ON ${t}_tl.id  = ${t}.location_id
    LEFT JOIN checkpoints ${t}_tcp ON ${t}_tcp.id = ${t}.checkpoint_id
    LEFT JOIN boats       ${t}_tb  ON ${t}_tb.id  = ${t}.boat_id
    LEFT JOIN vehicles    ${t}_tv  ON ${t}_tv.id  = ${t}.vehicle_id
    LEFT JOIN contacts    ${t}_tc  ON ${t}_tc.id  = ${t}.contact_id
    LEFT JOIN assets      ${t}_ta  ON ${t}_ta.id  = ${t}.asset_id`;
}

/** The resolved target of a row selected with {@link attachmentSelect}. */
export function attachmentOf(row: AttachedRow): AttachmentTarget | null {
  if (!row.target_type || !row.target_id) return null;
  return {
    type: row.target_type,
    id: row.target_id,
    label: row.target_label ?? fallbackLabel(row.target_type),
  };
}

// A target whose row is not on this device — outside the sync window, or
// deleted. Naming the kind is still more use than an empty string, and it is
// honest about what is missing.
function fallbackLabel(type: TargetType): string {
  switch (type) {
    case "contact":
      return "Unnamed contact";
    default:
      return TARGET_TYPES.find((t) => t.key === type)!.label;
  }
}

/** The column on notes/incidents/tickets that holds this kind of target. */
export type TargetColumn =
  | "location_id"
  | "checkpoint_id"
  | "boat_id"
  | "vehicle_id"
  | "contact_id"
  | "asset_id";

export function targetColumn(type: TargetType): TargetColumn {
  return TARGET_TYPES.find((t) => t.key === type)!.column;
}

/** Route to a target's detail page. */
export function targetPath(target: AttachmentTarget): string {
  switch (target.type) {
    case "location":
      return `/locations/${target.id}`;
    case "checkpoint":
      return `/locations/checkpoints/${target.id}`;
    case "boat":
      return `/boats/${target.id}`;
    case "vehicle":
      return `/vehicles/${target.id}`;
    case "contact":
      return `/contacts/${target.id}`;
    case "asset":
      return `/assets/${target.id}`;
  }
}

/** The six target columns, as an insertable object with one of them set. */
export function attachmentColumns(
  target: AttachmentTarget | null,
): Record<string, string | null> {
  const columns: Record<string, string | null> = {
    location_id: null,
    checkpoint_id: null,
    boat_id: null,
    vehicle_id: null,
    contact_id: null,
    asset_id: null,
  };
  if (target) {
    const spec = TARGET_TYPES.find((t) => t.key === target.type)!;
    columns[spec.column] = target.id;
  }
  return columns;
}

/**
 * Every row of one target kind, as pickable options.
 *
 * One query per kind rather than one per kind *plus* a mapping step, because
 * each kind names its label differently — a vehicle has a description where
 * everything else has a name — and SQL is the cheapest place to reconcile that.
 * An empty `type` yields no rows, which is the picker's initial state.
 */
export function useAttachmentOptions(type: TargetType | "") {
  const sql = ATTACHMENT_OPTION_SQL[type as TargetType] ?? "SELECT '' AS id, '' AS label WHERE 0";
  return useQuery<{ id: string; label: string }>(sql);
}

const ATTACHMENT_OPTION_SQL: Record<TargetType, string> = {
  location: "SELECT id, name AS label FROM locations ORDER BY name",
  checkpoint: "SELECT id, name AS label FROM checkpoints ORDER BY name",
  boat: "SELECT id, name AS label FROM boats ORDER BY name",
  vehicle: "SELECT id, description AS label FROM vehicles ORDER BY description",
  contact:
    "SELECT id, COALESCE(NULLIF(TRIM(name), ''), 'Unnamed contact') AS label FROM contacts ORDER BY label",
  asset: "SELECT id, name AS label FROM assets ORDER BY name",
};
