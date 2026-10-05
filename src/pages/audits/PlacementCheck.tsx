import { useState } from "react";
import { placementStyle, type PlacementShape } from "../../lib/locations";
import { placementOf } from "../../data/locations";
import { useLocationMap, useMapFit } from "../../data/maps";
import { attachmentUrl } from "../../data/files";
import { MapLabelEditor } from "../shared/MapLabelEditor";
import { DeviceDot } from "../shared/DeviceDot";
import { useDevicePosition } from "../shared/useDevicePosition";

// "Is it placed correctly on the map?" needs the map in front of the person
// answering. This shows the map the location is plotted on with its anchor
// and label highlighted and every other label muted, and the device's own
// position when the map can place it; the question sits UNDER the map, and
// only when there is a placement to ask about - a location that is not on
// the map yet is simply placed (owner, 2026-10-04). Tapping the map,
// answering No, or *Place it on the map* opens the fullscreen editor
// (shared/MapLabelEditor.tsx), which zooms.
//
// What comes back from the editor is a move_placement Proposal (docs/audits.md
// § What becomes a Proposal), never a write: every other user navigates by
// that map. Moving a label that was there answers No.

export interface ProposedPlacement {
  map_id: string;
  placement: PlacementShape;
}

export function PlacementCheck({
  locationId,
  locationName,
  editable,
  proposed,
  onPropose,
  answer,
  onAnswer,
  big,
}: {
  locationId: string;
  locationName: string;
  editable: boolean;
  proposed: ProposedPlacement | null;
  onPropose: (p: ProposedPlacement | null) => void;
  /** The answer to "placed correctly?", asked only when it is placed. */
  answer: boolean | null;
  onAnswer: (v: boolean) => void;
  /** The wizard's one-item-per-screen size. */
  big?: boolean;
}) {
  const [chosenMapId, setChosenMapId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { maps, map, own, placements } = useLocationMap(locationId, proposed?.map_id ?? chosenMapId);
  const fit = useMapFit(map?.id);
  const device = useDevicePosition();

  const imageUrl = map ? attachmentUrl(map.image_path) : null;
  const ownShape = own ? placementOf(own) : null;
  /** Where it is, as far as this check knows: the proposal wins. */
  const current: PlacementShape | null = proposed && map && proposed.map_id === map.id ? proposed.placement : ownShape;
  const placed = current !== null;

  if (!map) {
    return <div className="muted small">No marina map is uploaded, so placement cannot be checked here.</div>;
  }

  const chip = (v: boolean, text: string) => (
    <button
      type="button"
      className={`chip ${big ? "wz-chip-big" : ""} ${answer === v ? "tree-match" : ""}`}
      disabled={!editable}
      data-testid={v ? "placed-yes" : "placed-no"}
      onClick={() => {
        onAnswer(v);
        if (!v) setEditing(true);
      }}
    >
      {text}
    </button>
  );

  return (
    <div className="pc">
      <div className="pc-status">
        <span className="muted small">{own ? `On ${map.scope_name ?? map.name}` : proposed ? "Placed in this audit - waits for approval" : "Not on any map yet."}</span>
        {maps.length > 1 && editable && !own && !proposed && (
          <select className="select select-inline" value={map.id} onChange={(e) => setChosenMapId(e.target.value)} aria-label="Which map">
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.scope_name ?? m.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div
        className={`map-canvas map-schematic pc-preview ${editable ? "pc-tappable" : ""}`}
        data-testid="pc-preview"
        onClick={() => editable && setEditing(true)}
        role={editable ? "button" : undefined}
        aria-label={editable ? "Open the map" : undefined}
      >
        {imageUrl && <img src={imageUrl} alt={map.name} className="map-image" />}
        {placements.map((p) => {
          const mine = p.location_id === locationId;
          if (mine) return null;
          return (
            <span key={p.id} className="map-rect pc-other" style={placementStyle(placementOf(p))}>
              {p.location_name}
            </span>
          );
        })}
        <DeviceDot fit={fit} position={device} />
        {current && (
          <>
            <span className={`map-rect pc-mine ${proposed ? "pc-proposed-label" : ""}`} style={placementStyle(current)} title={proposed ? "Proposed placement — waits for approval" : undefined}>
              {locationName}
            </span>
            {(current.dx || current.dy) ? (
              <span className="map-anchor" style={{ left: `${current.cx}%`, top: `${current.cy}%` }} title={`${locationName} is here`} data-testid="pc-anchor" />
            ) : null}
          </>
        )}
        {editable && <span className="pc-zoom-hint">tap to zoom</span>}
      </div>

      {placed ? (
        <div className="pc-question">
          <span className={big ? "wz-d-label" : "field-label"} style={{ marginBottom: 0 }}>
            Is it placed correctly on the map?
          </span>
          <div className="chip-row" style={{ marginBottom: 0, justifyContent: big ? "center" : undefined }}>
            {chip(true, "Yes")}
            {chip(false, "No")}
          </div>
        </div>
      ) : (
        editable && (
          <button type="button" className={`btn btn-primary ${big ? "wz-btn-big" : "btn-sm"}`} data-testid="pc-place" onClick={() => setEditing(true)}>
            Place it on the map
          </button>
        )
      )}
      {proposed && (
        <div className="pc-proposed">
          <span className="badge badge-warn">New placement proposed - waits for approval</span>
          {editable && (
            <button type="button" className="btn btn-sm btn-bare" onClick={() => onPropose(null)}>
              discard
            </button>
          )}
        </div>
      )}

      {editing && editable && (
        <MapLabelEditor
          map={map}
          placements={placements}
          subject={{ locationId, name: locationName }}
          shape={current}
          fit={fit}
          removable={proposed !== null}
          removeLabel="Discard the proposal"
          onCancel={() => setEditing(false)}
          onDone={(shape) => {
            setEditing(false);
            if (!shape) {
              onPropose(null);
              return;
            }
            // Finishing where it already is proposes nothing.
            if (ownShape && sameShape(shape, ownShape) && !proposed) return;
            onPropose({ map_id: map.id, placement: shape });
            // Moving a label that was on the map says it was not placed
            // correctly. Placing one that was not on the map says nothing:
            // the question was never asked.
            if (ownShape) onAnswer(false);
          }}
        />
      )}
    </div>
  );
}

function sameShape(a: PlacementShape, b: PlacementShape): boolean {
  const keys = ["cx", "cy", "dx", "dy", "rotation", "fontSize", "paddingX", "paddingY"] as const;
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
