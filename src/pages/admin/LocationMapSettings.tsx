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
import { DraftNumberInput } from "../shared/DraftInput";
import { MapPreview } from "../shared/MapPreview";

export function LocationMapSettings({
  location,
  onGps,
  onGpsField,
}: {
  location: LocationRow;
  /** Both coordinates at once, from the device. */
  onGps: (lat: number, lng: number) => void;
  /** One coordinate typed. */
  onGpsField: (changes: { gpsLat?: number | null; gpsLng?: number | null }) => void;
}) {
  const [chosenMapId, setChosenMapId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"label" | "anchor" | null>(null);
  const { maps, map, own, placements } = useLocationMap(location.id, chosenMapId);
  const fit = useMapFit(map?.id);
  const device = useDevicePosition();
  const shape: PlacementShape | null = own ? placementOf(own) : null;
  const pinned = location.gps_lat !== null && location.gps_lng !== null;
  const inside = fit && pinned ? fit.toMap(location.gps_lat!, location.gps_lng!).inside : null;

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
      <div className="field-inline">
        <span className="field-label">GPS</span>
        <div className="field-control row" style={{ gap: 6, flexWrap: "wrap" }}>
          <DraftNumberInput className="input select-inline" style={{ width: 120 }} placeholder="latitude" aria-label="Latitude" value={location.gps_lat} onCommit={(gpsLat) => onGpsField({ gpsLat })} />
          <DraftNumberInput className="input select-inline" style={{ width: 120 }} placeholder="longitude" aria-label="Longitude" value={location.gps_lng} onCommit={(gpsLng) => onGpsField({ gpsLng })} />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!device}
            title={device ? `±${Math.round(device.accuracy)} m` : "No fix from this device yet"}
            data-testid="loc-use-position"
            onClick={() => device && onGps(+device.lat.toFixed(7), +device.lng.toFixed(7))}
          >
            Use my position{device ? ` · ±${Math.round(device.accuracy)} m` : ""}
          </button>
        </div>
      </div>
      <div className="field-inline">
        <span className="field-label">Map</span>
        <div className="field-control">
          {maps.length === 0 ? (
            <span className="muted small">No maps uploaded yet - see Maps &amp; plotting.</span>
          ) : (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {own && map ? (
                <span className="small" data-testid="loc-map-status">
                  On <b>{map.scope_name ?? map.name}</b>
                  {shape!.dx || shape!.dy ? `, label offset ${signed(shape!.dx ?? 0)}, ${signed(shape!.dy ?? 0)}` : ""}
                  {inside === null ? "" : inside ? " · inside the calibrated area" : " · outside the calibrated area"}
                </span>
              ) : (
                <>
                  <span className="small muted" data-testid="loc-map-status">
                    Not on a map.
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
              <button type="button" className="btn btn-sm" disabled={!map} data-testid="loc-set-anchor" onClick={() => setEditing("anchor")}>
                {own ? "Move" : "Place on the map"}
              </button>
              {own && (
                <button type="button" className="btn btn-sm" data-testid="loc-edit-label" onClick={() => setEditing("label")}>
                  Label
                </button>
              )}
              {own && (
                <button type="button" className="btn btn-sm btn-bare" onClick={() => finish(null)}>
                  Remove
                </button>
              )}
            </div>
          )}
          {!pinned && own && <span className="muted small" style={{ display: "block", marginTop: 4 }}>With coordinates as well, it would help place people on this map.</span>}
        </div>
      </div>
      {map && (
        <MapPreview
          map={map}
          placements={placements}
          subject={{ locationId: location.id, name: location.name }}
          shape={shape}
          fit={fit}
          device={device}
          onOpen={() => setEditing(own ? "label" : "anchor")}
          testId="loc-map-preview"
        />
      )}

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
