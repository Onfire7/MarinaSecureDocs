// Maps as the pages need them (docs/maps.md): which map a location belongs
// on with its anchor and label, and the GPS-to-map fit for a map, built
// from its anchors - saved ones, and the provisional ones an open audit
// has proposed (owner, 2026-10-05: the dot should improve during the walk,
// not after approval).
import { useMemo } from "react";
import { useQuery } from "@powersync/react";
import { placementFromPayload } from "../lib/auditWizard";
import { buildMapFit, controlPointsFor, type MapFit } from "../lib/mapFit";
import { anchorGps, useLocations, useMapAnchors, useMapLabels, useMarinaMaps, type MapAnchorRow, type MapLabelRow, type MarinaMapRow } from "./locations";

/** The map a location is shown on: the one it is anchored or labelled on,
 *  else the map of its nearest ancestor that has one, else the first
 *  overview map - so a slip added in the field can be placed on its dock's
 *  map. Returns every map too, for a chooser, and what is on the chosen one. */
export function useLocationMap(locationId: string | null | undefined, preferMapId?: string | null) {
  const { data: maps } = useMarinaMaps();
  const { data: anchors } = useMapAnchors();
  const { data: labels } = useMapLabels();
  const { data: locations } = useLocations();
  const ownAnchorAny = locationId ? (anchors.find((a) => a.location_id === locationId) ?? null) : null;
  const ownLabelAny = locationId ? (labels.find((b) => b.location_id === locationId) ?? null) : null;
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
  const mapId = preferMapId ?? ownAnchorAny?.map_id ?? ownLabelAny?.map_id ?? fallback?.id ?? null;
  const map: MarinaMapRow | null = maps.find((m) => m.id === mapId) ?? null;
  const onMapAnchors: MapAnchorRow[] = anchors.filter((a) => a.map_id === mapId);
  const onMapLabels: MapLabelRow[] = labels.filter((b) => b.map_id === mapId);
  return {
    maps,
    map,
    anchor: ownAnchorAny && ownAnchorAny.map_id === mapId ? ownAnchorAny : null,
    label: ownLabelAny && ownLabelAny.map_id === mapId ? ownLabelAny : null,
    anchors: onMapAnchors,
    labels: onMapLabels,
    locations,
  };
}

interface ProvisionalRow {
  kind: "set_gps" | "move_placement";
  payload: string;
  location_id: string;
  location_name: string;
  gps_lat: number | null;
  gps_lng: number | null;
}

/** Anchors an open audit has proposed and nobody has decided on yet: a
 *  tapped anchor (move_placement) paired with the fix captured beside it
 *  (set_gps), or with the location's saved coordinates when there was no
 *  fix. Each is a control point now, flagged provisional. */
export function useProvisionalAnchors(mapId: string | null | undefined) {
  const { data } = useQuery<ProvisionalRow>(
    `SELECT p.kind, p.payload, t.location_id, l.name AS location_name, l.gps_lat, l.gps_lng
       FROM audit_proposals p
       JOIN audit_findings f ON f.id = p.finding_id
       JOIN audit_targets t ON t.id = f.target_id
       JOIN locations l ON l.id = t.location_id
      WHERE p.decision IS NULL AND p.kind IN ('set_gps', 'move_placement')`,
  );
  return useMemo(() => {
    if (!mapId) return [];
    const byLocation = new Map<string, { name: string; anchor: { cx: number; cy: number } | null; fix: { lat: number; lng: number } | null; saved: { lat: number; lng: number } | null }>();
    for (const r of data) {
      const entry = byLocation.get(r.location_id) ?? {
        name: r.location_name,
        anchor: null,
        fix: null,
        saved: r.gps_lat !== null && r.gps_lng !== null ? { lat: r.gps_lat, lng: r.gps_lng } : null,
      };
      const payload = parse(r.payload);
      if (r.kind === "move_placement") {
        const pl = placementFromPayload(payload);
        if (pl && pl.map_id === mapId && pl.anchor) entry.anchor = pl.anchor;
      } else if (typeof payload.lat === "number" && typeof payload.lng === "number") {
        entry.fix = { lat: payload.lat, lng: payload.lng };
      }
      byLocation.set(r.location_id, entry);
    }
    const out: { cx: number; cy: number; lat: number | null; lng: number | null; label: string; locationId: string; provisional: true }[] = [];
    for (const [locationId, e] of byLocation) {
      if (!e.anchor) continue;
      const gps = e.fix ?? e.saved;
      out.push({ cx: e.anchor.cx, cy: e.anchor.cy, lat: gps?.lat ?? null, lng: gps?.lng ?? null, label: e.name, locationId, provisional: true });
    }
    return out;
  }, [data, mapId]);
}

/** The piecewise fit for a map, from every anchor on it that carries
 *  coordinates - saved or provisional; null until there are three that are
 *  not in a line. */
export function useMapFit(mapId: string | null | undefined): MapFit | null {
  const { data: anchors } = useMapAnchors(mapId ?? undefined);
  const provisional = useProvisionalAnchors(mapId);
  return useMemo(() => {
    if (!mapId) return null;
    const saved = anchors.map((a) => {
      const gps = anchorGps(a);
      return { cx: a.cx, cy: a.cy, lat: gps?.lat ?? null, lng: gps?.lng ?? null, label: a.location_name ?? a.label ?? "point", locationId: a.location_id };
    });
    return buildMapFit(controlPointsFor([...saved, ...provisional]));
  }, [mapId, anchors, provisional]);
}

function parse(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
