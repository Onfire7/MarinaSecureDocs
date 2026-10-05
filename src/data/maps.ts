// Maps as the pages need them (docs/maps.md): which map a location belongs
// on, and the GPS-to-map fit for a map, built from its control points.
import { useMemo } from "react";
import { buildMapFit, controlPointsFor, type MapFit } from "../lib/mapFit";
import { placementOf, useLocations, useMarinaMaps, usePlacements, type MarinaMapRow, type PlacementRow } from "./locations";

/** The map a location is shown on: the one it is placed on, else the map
 *  of its nearest ancestor that has one, else the first overview map - so
 *  a slip added in the field can be placed on its dock's map. Returns every
 *  map too, for a chooser, and the placements on the chosen one. */
export function useLocationMap(locationId: string | null | undefined, preferMapId?: string | null) {
  const { data: maps } = useMarinaMaps();
  const { data: placements } = usePlacements();
  const { data: locations } = useLocations();
  const own = locationId ? (placements.find((p) => p.location_id === locationId) ?? null) : null;
  const fallback = useMemo(() => {
    if (!locationId) return maps.find((m) => !m.scope_parent_id) ?? null;
    const byId = new Map(locations.map((l) => [l.id, l]));
    let cursor = byId.get(locationId)?.parent_id ?? null;
    let guard = 0;
    while (cursor && guard++ < 32) {
      const m = maps.find((x) => x.scope_id === cursor);
      if (m) return m;
      cursor = byId.get(cursor)?.parent_id ?? null;
    }
    return maps.find((m) => !m.scope_parent_id) ?? null;
  }, [locations, maps, locationId]);
  const mapId = preferMapId ?? own?.map_id ?? fallback?.id ?? null;
  const map: MarinaMapRow | null = maps.find((m) => m.id === mapId) ?? null;
  const onMap: PlacementRow[] = placements.filter((p) => p.map_id === mapId);
  return { maps, map, own: own && own.map_id === mapId ? own : null, placements: onMap, locations };
}

/** The piecewise fit for a map, from every placement on it whose location
 *  is pinned; null until there are three that are not in a line. Rebuilt
 *  only when the placements or the locations change. */
export function useMapFit(mapId: string | null | undefined): MapFit | null {
  const { data: placements } = usePlacements(mapId ?? undefined);
  const { data: locations } = useLocations();
  return useMemo(() => {
    if (!mapId) return null;
    const anchors = placements.map((p) => {
      const s = placementOf(p);
      return { location_id: p.location_id, cx: s.cx, cy: s.cy };
    });
    return buildMapFit(controlPointsFor(anchors, locations));
  }, [mapId, placements, locations]);
}
