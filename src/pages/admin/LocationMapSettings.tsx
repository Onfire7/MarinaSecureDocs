// A location's place on the map, from its admin row (docs/maps.md): which
// map it is on, its anchor and label, and the buttons that open the shared
// editor to set them. Admin writes placements directly - there is no
// Proposal to wait on here - through the same data functions the plotter
// uses. "Use my position" beside the coordinates fills them from the
// device, under no accuracy rule: an admin at a desk typing coordinates
// off a satellite view is the normal case, and the audit's capture rules
// are the audit's.
import { useState } from "react";
import type { PlacementShape } from "../../lib/locations";
import { createPlacement, deletePlacement, placementOf, savePlacement, type LocationRow } from "../../data/locations";
import { useLocationMap, useMapFit } from "../../data/maps";
import { MapLabelEditor } from "../shared/MapLabelEditor";
import { useDevicePosition } from "../shared/useDevicePosition";

export function LocationMapSettings({ location, onGps }: { location: LocationRow; onGps: (lat: number, lng: number) => void }) {
  const [chosenMapId, setChosenMapId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"label" | "anchor" | null>(null);
  const { maps, map, own, placements } = useLocationMap(location.id, chosenMapId);
  const fit = useMapFit(map?.id);
  const device = useDevicePosition();
  const shape: PlacementShape | null = own ? placementOf(own) : null;
  const pinned = location.gps_lat !== null && location.gps_lng !== null;

  const finish = (next: PlacementShape | null) => {
    setEditing(null);
    if (!map) return;
    if (!next) {
      if (own) void deletePlacement(own.id);
      return;
    }
    if (own) void savePlacement(own.id, next);
    else void createPlacement(map.id, location.id, next);
  };

  return (
    <>
      <div className="row" style={{ marginTop: 4, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!device}
          title={device ? `±${Math.round(device.accuracy)} m` : "No fix from this device yet"}
          data-testid="loc-use-position"
          onClick={() => device && onGps(+device.lat.toFixed(7), +device.lng.toFixed(7))}
        >
          Use my position{device ? ` (±${Math.round(device.accuracy)} m)` : ""}
        </button>
        {fit && pinned && (
          <span className="muted small">
            {(() => {
              const at = fit.toMap(location.gps_lat!, location.gps_lng!);
              return at.inside ? "Inside the calibrated part of the map." : "Outside the calibrated part of the map.";
            })()}
          </span>
        )}
      </div>

      <div className="field" style={{ marginTop: 10 }}>
        <span className="field-label">On the map</span>
        {maps.length === 0 ? (
          <span className="muted small">No maps uploaded yet - Maps &amp; plotting.</span>
        ) : (
          <>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {own && map ? (
                <span className="small" data-testid="loc-map-status">
                  On <b>{map.scope_name ?? map.name}</b> at {shape!.cx.toFixed(1)}%, {shape!.cy.toFixed(1)}%
                  {shape!.dx || shape!.dy ? ` · label ${signed(shape!.dx ?? 0)}, ${signed(shape!.dy ?? 0)}` : " · label on the anchor"}
                </span>
              ) : (
                <>
                  <span className="small muted" data-testid="loc-map-status">
                    Not on any map.
                  </span>
                  {maps.length > 1 && (
                    <select className="select select-inline" value={map?.id ?? ""} onChange={(e) => setChosenMapId(e.target.value)} aria-label="Which map">
                      {maps.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.scope_name ?? m.name}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm" disabled={!map} data-testid="loc-set-anchor" onClick={() => setEditing("anchor")}>
                {own ? "Move the anchor" : "Place on the map"}
              </button>
              {own && (
                <button type="button" className="btn btn-sm" data-testid="loc-edit-label" onClick={() => setEditing("label")}>
                  Edit the label
                </button>
              )}
              {own && (
                <button type="button" className="btn btn-sm btn-bare" onClick={() => finish(null)}>
                  Remove from the map
                </button>
              )}
            </div>
            {!pinned && (
              <span className="muted small" style={{ display: "block", marginTop: 4 }}>
                Give it coordinates too and it becomes a control point for where people are on this map.
              </span>
            )}
          </>
        )}
      </div>

      {editing && map && (
        <MapLabelEditor
          map={map}
          placements={placements}
          subject={{ locationId: location.id, name: location.name }}
          shape={shape}
          mode={editing}
          fit={fit}
          removable={editing === "label" && own !== null}
          onCancel={() => setEditing(null)}
          onDone={finish}
        />
      )}
    </>
  );
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}
