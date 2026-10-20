// A location's place on the maps, from its admin row (docs/maps.md § A
// location on several maps): every map it is on, one line each with the
// buttons that open the shared editor on that map or take it off that map
// alone, *Add to another map...* for the rest, and the selected map's
// preview. Admin writes anchors and labels directly - there is
// no Proposal to wait on here - through the same data functions the
// plotter uses. "Use my position" beside the coordinates fills them from
// the device, under no accuracy rule: an admin at a desk typing coordinates
// off a satellite view is the normal case, and the audit's capture rules
// are the audit's.
import { useState } from "react";
import type { LabelShape, MapPoint } from "../../lib/locations";
import { labelShapeOf, type LocationRow } from "../../data/locations";
import { removeLocationPlace, saveLocationPlace, useLocationMap, useMapFit } from "../../data/maps";
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
  const { maps, map, onMapIds, ownAnchors, ownLabels, anchor: anchorRow, label: labelRow, anchors, labels } = useLocationMap(location.id, chosenMapId);
  const fit = useMapFit(map?.id);
  const device = useDevicePosition();
  const anchor: MapPoint | null = anchorRow ? { cx: anchorRow.cx, cy: anchorRow.cy } : null;
  const label: LabelShape | null = labelRow ? labelShapeOf(labelRow) : null;
  const onMap = anchor !== null || label !== null;
  const pinned = location.gps_lat !== null && location.gps_lng !== null;
  const inside = fit && pinned ? fit.toMap(location.gps_lat!, location.gps_lng!).inside : null;

  const finish = (next: EditedPlace) => {
    setEditing(null);
    if (map) saveLocationPlace({ mapId: map.id, location, anchorRow, labelRow, next });
  };
  const removeAll = () => {
    setEditing(null);
    removeLocationPlace(anchorRow, labelRow);
  };
  /** Off one map only; the rest stay. */
  const removeFrom = (mapId: string) => {
    if (mapId === map?.id) setEditing(null);
    removeLocationPlace(ownAnchors.find((a) => a.map_id === mapId) ?? null, ownLabels.find((b) => b.map_id === mapId) ?? null);
    if (mapId === chosenMapId) setChosenMapId(null);
  };
  const open = (mapId: string, mode: "label" | "anchor") => {
    setChosenMapId(mapId);
    setEditing(mode);
  };
  const nameOf = (m: { name: string; scope_name: string | null }) => m.scope_name ?? m.name;
  const onMaps = maps.filter((m) => onMapIds.includes(m.id));
  const offMaps = maps.filter((m) => !onMapIds.includes(m.id));

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
            <div className="stack" style={{ gap: 6 }}>
              {onMaps.map((m) => {
                const selected = m.id === map?.id;
                const a = ownAnchors.find((x) => x.map_id === m.id);
                const b = ownLabels.find((x) => x.map_id === m.id);
                const shape = b ? labelShapeOf(b) : null;
                return (
                  <div key={m.id} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="loc-map-row" data-map-id={m.id}>
                    <button type="button" className={`btn btn-sm btn-bare ${selected ? "tree-match" : ""}`} onClick={() => setChosenMapId(m.id)} aria-pressed={selected} title="Show this map below">
                      On <b>{nameOf(m)}</b>
                    </button>
                    <span className="small muted" data-testid={selected ? "loc-map-status" : undefined}>
                      {[
                        a ? null : "no anchor",
                        !b ? "no label" : shape?.outline ? (shape.showText === false ? "outline" : "outline and label") : null,
                        selected && inside !== null ? (inside ? "inside the calibrated area" : "outside the calibrated area") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <button type="button" className="btn btn-sm" data-testid="loc-set-anchor" onClick={() => open(m.id, "anchor")}>
                      Move
                    </button>
                    <button type="button" className="btn btn-sm" data-testid="loc-edit-label" onClick={() => open(m.id, "label")}>
                      Label / outline
                    </button>
                    <button type="button" className="btn btn-sm btn-bare" data-testid="loc-map-remove" onClick={() => removeFrom(m.id)}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {onMaps.length === 0 && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="small muted" data-testid="loc-map-status">
                    Not on a map.
                  </span>
                  {maps.length > 1 && (
                    <select className="select select-inline" value={map?.id ?? ""} onChange={(e) => setChosenMapId(e.target.value)} aria-label="Which map">
                      {maps.map((m) => (
                        <option key={m.id} value={m.id}>
                          {nameOf(m)}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" className="btn btn-sm" disabled={!map} data-testid="loc-set-anchor" onClick={() => setEditing("anchor")}>
                    Place on the map
                  </button>
                </div>
              )}
              {onMaps.length > 0 && offMaps.length > 0 && (
                <select
                  className="select select-inline"
                  value=""
                  onChange={(e) => e.target.value && open(e.target.value, "anchor")}
                  aria-label="Add to another map"
                  data-testid="loc-map-add"
                >
                  <option value="">Add to another map...</option>
                  {offMaps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {nameOf(m)}
                    </option>
                  ))}
                </select>
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
