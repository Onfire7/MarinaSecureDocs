import { useMemo, useState } from "react";
import { placementStyle } from "../../lib/locations";
import {
  placementOf,
  useMarinaMaps,
  usePlacements,
  type MarinaMapRow,
} from "../../data/locations";
import { attachmentUrl } from "../../data/files";

// Shared schematic-map renderer: a marina map image with a rectangle per
// plotted location, a root-map chooser, and drill-down into scoped detail maps.
//
// One capability, two overlays (see docs/data-model.md — LocationMapPlacement):
// the Location list colours by status, the Reservations map by reservation
// state. Callers supply colorFor and which locations to include; the maps and
// placements themselves are the same either way, so this fetches them rather
// than having both callers carry the same query.

export interface RectStyle {
  background: string;
  border: string;
  text: string;
}

export function SchematicMapView({
  colorFor,
  include,
  onOpen,
  footnote,
}: {
  /** Fill/border for a location's rectangle. */
  colorFor: (locationId: string) => RectStyle;
  /** Omit a location's rectangle entirely when false (e.g. non-reservable). */
  include?: (locationId: string) => boolean;
  onOpen: (locationId: string) => void;
  footnote?: string;
}) {
  const { data: maps } = useMarinaMaps();
  const { data: allPlacements } = usePlacements();
  const [mapStack, setMapStack] = useState<MarinaMapRow[]>([]);

  const placementsByMap = useMemo(() => {
    const m = new Map<string, typeof allPlacements>();
    for (const p of allPlacements) {
      const list = m.get(p.map_id) ?? [];
      list.push(p);
      m.set(p.map_id, list);
    }
    return m;
  }, [allPlacements]);

  const rootMaps = maps.filter((m) => !m.scope_parent_id);
  const mapForLocation = (locationId: string) =>
    maps.find((m) => m.scope_id === locationId);

  const active =
    mapStack.at(-1) ?? (rootMaps.length === 1 ? rootMaps[0] : undefined);

  // Multi-property marina: choose which root overview map to open first.
  if (!active) {
    return (
      <div className="stack">
        <div className="section-title">Choose a property</div>
        {rootMaps.map((m) => (
          <button
            key={m.id}
            type="button"
            className="card spread"
            style={{ cursor: "pointer", textAlign: "left", font: "inherit" }}
            onClick={() => setMapStack([m])}
          >
            <span className="card-title">{m.scope_name ?? m.name}</span>
            <span className="muted small">
              {(placementsByMap.get(m.id) ?? []).length} plotted
            </span>
          </button>
        ))}
        {rootMaps.length === 0 && (
          <div className="placeholder">
            <div className="big">No overview map uploaded yet</div>
            Maps are uploaded and plotted in Admin → Locations.
          </div>
        )}
      </div>
    );
  }

  const imageUrl = attachmentUrl(active.image_path);
  const placements = placementsByMap.get(active.id) ?? [];

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {(mapStack.length > 1 || (mapStack.length === 1 && rootMaps.length > 1)) && (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setMapStack(mapStack.slice(0, -1))}
          >
            ← Back
          </button>
        )}
        <span className="section-title" style={{ marginBottom: 0 }}>
          {active.scope_name ?? active.name}
        </span>
      </div>

      <div className="map-canvas map-schematic">
        {imageUrl && (
          <img src={imageUrl} alt={active.name} className="map-image" />
        )}
        {placements.map((p) => {
          if (include && !include(p.location_id)) return null;
          const colors = colorFor(p.location_id);
          const childMap = mapForLocation(p.location_id);
          return (
            <button
              key={p.id}
              type="button"
              className="map-rect"
              style={{
                ...placementStyle(placementOf(p)),
                background: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }}
              title={p.location_name}
              onClick={() =>
                childMap
                  ? setMapStack([...mapStack, childMap])
                  : onOpen(p.location_id)
              }
            >
              {p.location_name}
              {childMap && " ▸"}
            </button>
          );
        })}
      </div>
      {footnote && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {footnote}
        </p>
      )}
    </div>
  );
}
