/**
 * Checkpoints are identified by *where they are* at least as much as by what
 * they're called. Left ungrouped, a list of "Gate", "Walkway", "Back Door"
 * is unreadable, which is why marinas end up baking the location into the
 * name — "Water Storage #2 - Pavilion", "The Point - Back Door". Grouping
 * under the parent location carries that information structurally instead, so
 * a checkpoint can just be called "Gate".
 */

export interface LocationNode {
  id: string;
  name: string;
  parent?: { id: string } | null;
}

export interface CheckpointLike {
  id: string;
  name: string;
  location?: { id: string; name: string } | null;
}

export const NO_LOCATION_LABEL = "No location";

/**
 * Resolves a location's full ancestor path ("Marina → Boathouses → BH30").
 * Memoized per call, and depth-guarded because a cycle in the parent links
 * would otherwise recurse forever.
 */
export function locationPathResolver(
  locations: LocationNode[],
): (locationId: string) => string {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const cache = new Map<string, string>();
  const resolve = (locationId: string, depth = 0): string => {
    const cached = cache.get(locationId);
    if (cached != null) return cached;
    const l = byId.get(locationId);
    if (!l) return "";
    const parentId = l.parent?.id;
    const prefix = parentId && depth < 30 ? resolve(parentId, depth + 1) : "";
    const full = prefix ? `${prefix} → ${l.name}` : l.name;
    cache.set(locationId, full);
    return full;
  };
  return resolve;
}

export interface CheckpointGroup<T> {
  locationId: string;
  /** Full ancestor path when a resolver was supplied, else the bare name. */
  label: string;
  items: T[];
}

/**
 * Groups checkpoints under their parent location.
 *
 * @param pathOf optional resolver; with it, group labels carry the full
 *   ancestor path, which is what disambiguates the "Gate" that exists on
 *   every dock.
 */
export function groupByLocation<T extends CheckpointLike>(
  checkpoints: T[],
  pathOf?: (locationId: string) => string,
): CheckpointGroup<T>[] {
  const groups = new Map<string, CheckpointGroup<T>>();
  for (const cp of checkpoints) {
    const locationId = cp.location?.id ?? "";
    let g = groups.get(locationId);
    if (!g) {
      g = {
        locationId,
        label: cp.location
          ? (pathOf?.(cp.location.id) || cp.location.name)
          : NO_LOCATION_LABEL,
        items: [],
      };
      groups.set(locationId, g);
    }
    g.items.push(cp);
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }
  // Numeric collation so Dock 2 precedes Dock 10; unlocated checkpoints last,
  // since they're a defect to fix rather than a place to look.
  return [...groups.values()].sort((a, b) => {
    if (!a.locationId) return 1;
    if (!b.locationId) return -1;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}
