// The attachable-entities pattern (see docs: data-model.html — every Note,
// Incident, and Ticket attaches to exactly one target). The schema models
// this as six optional links; these helpers pick the one that's set and
// build the .link() payload when creating.

export const TARGET_TYPES = [
  { key: "location", label: "Location" },
  { key: "checkpoint", label: "Checkpoint" },
  { key: "boat", label: "Boat" },
  { key: "vehicle", label: "Vehicle" },
  { key: "contact", label: "Contact" },
  { key: "asset", label: "Asset" },
] as const;

export type TargetType = (typeof TARGET_TYPES)[number]["key"];

export interface AttachmentTarget {
  type: TargetType;
  id: string;
  label: string;
}

type Named = { id: string; name?: string | null } | null | undefined;
type Described = { id: string; description: string } | null | undefined;

export interface Attachable {
  location?: Named;
  checkpoint?: Named;
  boat?: Named;
  vehicle?: Described;
  contact?: Named;
  asset?: Named;
}

// Route to each target's detail page (placeholders for groups not built yet).
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
      return "/contacts";
    case "asset":
      return "/assets";
  }
}

export function attachmentOf(entity: Attachable): AttachmentTarget | null {
  if (entity.location)
    return { type: "location", id: entity.location.id, label: entity.location.name ?? "Location" };
  if (entity.checkpoint)
    return { type: "checkpoint", id: entity.checkpoint.id, label: entity.checkpoint.name ?? "Checkpoint" };
  if (entity.boat)
    return { type: "boat", id: entity.boat.id, label: entity.boat.name ?? "Boat" };
  if (entity.vehicle)
    return { type: "vehicle", id: entity.vehicle.id, label: entity.vehicle.description };
  if (entity.contact)
    return { type: "contact", id: entity.contact.id, label: entity.contact.name ?? "Unnamed contact" };
  if (entity.asset)
    return { type: "asset", id: entity.asset.id, label: entity.asset.name ?? "Asset" };
  return null;
}

/** `.link()` payload attaching a record to its one target. */
export function attachmentLink(target: AttachmentTarget): Record<string, string> {
  return { [target.type]: target.id };
}

// Query fragment loading all six target links (spread into a ticket/incident
// query so attachmentOf can resolve).
export const ATTACHMENT_LINKS_QUERY = {
  location: {},
  checkpoint: {},
  boat: {},
  vehicle: {},
  contact: {},
  asset: {},
} as const;
