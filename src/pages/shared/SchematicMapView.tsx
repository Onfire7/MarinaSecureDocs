import { useState } from "react";
import { placementStyle, type PlacementShape } from "../../lib/locations";

// Shared schematic-map renderer: MarinaMap image + LocationMapPlacement
// rectangles, with root-map chooser and drill-down into scoped detail maps.
// One shared capability, two overlays (see docs: data-model.html —
// LocationMapPlacement): Location list colors by occupancy/type, the
// Reservations map colors by reservation status — callers supply colorFor
// and which locations to include.

export interface MapPlacementRecord {
  id: string;
  placement: PlacementShape;
  location?: { id: string; name: string } | null;
}

export interface MarinaMapRecord {
  id: string;
  name: string;
  scope?: { id: string; name: string; parent?: { id: string } | null } | null;
  image?: { url: string } | null;
  placements?: MapPlacementRecord[];
}

export interface RectStyle {
  background: string;
  border: string;
  text: string;
}

export function SchematicMapView({
  maps,
  colorFor,
  include,
  onOpen,
  footnote,
}: {
  maps: MarinaMapRecord[];
  /** Fill/border for a location's rectangle. */
  colorFor: (locationId: string) => RectStyle;
  /** Omit a location's rectangle entirely when false (e.g. non-reservable). */
  include?: (locationId: string) => boolean;
  onOpen: (locationId: string) => void;
  footnote?: string;
}) {
  const [mapStack, setMapStack] = useState<MarinaMapRecord[]>([]);

  const rootMaps = maps.filter((m) => !m.scope?.parent);
  const mapForLocation = (locationId: string) =>
    maps.find((m) => m.scope?.id === locationId);

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
            <span className="card-title">{m.scope?.name ?? m.name}</span>
            <span className="muted small">{m.placements?.length ?? 0} plotted</span>
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
          {active.scope?.name ?? active.name}
        </span>
      </div>

      <div className="map-canvas map-schematic">
        {active.image?.url && (
          <img src={active.image.url} alt={active.name} className="map-image" />
        )}
        {(active.placements ?? []).map((p) => {
          if (!p.location) return null;
          if (include && !include(p.location.id)) return null;
          const colors = colorFor(p.location.id);
          const childMap = mapForLocation(p.location.id);
          return (
            <button
              key={p.id}
              type="button"
              className="map-rect"
              style={{
                ...placementStyle(p.placement),
                background: colors.background,
                borderColor: colors.border,
                color: colors.text,
              }}
              title={p.location.name}
              onClick={() =>
                childMap
                  ? setMapStack([...mapStack, childMap])
                  : onOpen(p.location!.id)
              }
            >
              {p.location.name}
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
