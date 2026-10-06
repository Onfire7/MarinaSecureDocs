// A location's place on the map, from its admin row (docs/maps.md): which
// map it is on, its anchor and label, and the buttons that open the shared
// editor to set them. Admin writes anchors and labels directly - there is
// no Proposal to wait on here - through the same data functions the
// plotter uses. "Use my position" beside the coordinates fills them from
// the device, under no accuracy rule: an admin at a desk typing coordinates
// off a satellite view is the normal case, and the audit's capture rules
// are the audit's.
import { useState } from "react";
import type { LabelShape, MapPoint } from "../../lib/locations";
import { createAnchor, createLabel, deleteAnchor, deleteLabel, labelShapeOf, saveAnchor, saveLabel, type LocationRow } from "../../data/locations";
import { useLocationMap, useMapFit } from "../../data/maps";
import { MapLabelEditor, type EditedPlace } from "../shared/MapLabelEditor";
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
  const { maps, map, anchor: anchorRow, label: labelRow, anchors, labels } = useLocationMap(location.id, chosenMapId);
  const fit = useMapFit(map?.id);
  const device = useDevicePosition();
  const anchor: MapPoint | null = anchorRow ? { cx: anchorRow.cx, cy: anchorRow.cy } : null;
  const label: LabelShape | null = labelRow ? labelShapeOf(labelRow) : null;
  const onMap = anchor !== null || label !== null;
  const pinned = location.gps_lat !== null && location.gps_lng !== null;
  const inside = fit && pinned ? fit.toMap(location.gps_lat!, location.gps_lng!).inside : null;

  const finish = (next: EditedPlace) => {
    setEditing(null);
    if (!map) return;
    const gps = next.point && next.point.lat !== null && next.point.lng !== null ? { lat: next.point.lat, lng: next.point.lng } : null;
    if (gps && (gps.lat !== location.gps_lat || gps.lng !== location.gps_lng)) onGps(gps.lat, gps.lng);
    if (next.anchor) {
      if (anchorRow) void saveAnchor(anchorRow.id, { cx: next.anchor.cx, cy: next.anchor.cy, ...(gps ?? {}) });
      else void createAnchor({ mapId: map.id, locationId: location.id, cx: next.anchor.cx, cy: next.anchor.cy, lat: gps?.lat ?? location.gps_lat, lng: gps?.lng ?? location.gps_lng });
    } else if (anchorRow && gps) void saveAnchor(anchorRow.id, gps);
    if (next.label) {
      if (labelRow) void saveLabel(labelRow.id, next.label);
      else void createLabel(map.id, location.id, next.label);
    } else if (labelRow) void deleteLabel(labelRow.id);
  };
  const removeAll = () => {
    setEditing(null);
    if (anchorRow) void deleteAnchor(anchorRow.id);
    if (labelRow) void deleteLabel(labelRow.id);
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
              {onMap && map ? (
                <span className="small" data-testid="loc-map-status">
                  On <b>{map.scope_name ?? map.name}</b>
                  {anchor ? "" : ", label only"}
                  {label ? "" : ", no label"}
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
                {anchor ? "Move" : "Place on the map"}
              </button>
              {onMap && (
                <button type="button" className="btn btn-sm" data-testid="loc-edit-label" onClick={() => setEditing("label")}>
                  Label
                </button>
              )}
              {onMap && (
                <button type="button" className="btn btn-sm btn-bare" onClick={removeAll}>
                  Remove
                </button>
              )}
            </div>
          )}
          {!pinned && onMap && <span className="muted small" style={{ display: "block", marginTop: 4 }}>With coordinates as well, it would help place people on this map.</span>}
        </div>
      </div>
      {map && (
        <MapPreview
          map={map}
          anchors={anchors}
          labels={labels}
          subject={{ locationId: location.id, name: location.name }}
          anchor={anchor}
          label={label}
          fit={fit}
          device={device}
          onOpen={() => setEditing(onMap ? "label" : "anchor")}
          testId="loc-map-preview"
        />
      )}

      {editing && map && (
        <MapLabelEditor
          map={map}
          anchors={anchors}
          labels={labels}
          subject={{ locationId: location.id, name: location.name }}
          anchor={anchor}
          label={label}
          mode={editing}
          fit={fit}
          coords
          point={{ name: location.name, lat: location.gps_lat, lng: location.gps_lng }}
          removable={editing === "label" && onMap}
          removeLabel="Remove from this map"
          onCancel={() => setEditing(null)}
          onRemove={removeAll}
          onDone={finish}
        />
      )}
    </>
  );
}
