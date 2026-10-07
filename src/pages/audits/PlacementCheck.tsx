import { useState } from "react";
import type { LabelShape, MapPoint } from "../../lib/locations";
import type { MapPlacement } from "../../lib/auditWizard";
import { labelShapeOf } from "../../data/locations";
import { useLocationMap, useMapFit } from "../../data/maps";
import { MapLabelEditor } from "../shared/MapLabelEditor";
import { MapPreview } from "../shared/MapPreview";
import { useDevicePosition } from "../shared/useDevicePosition";

// "Is it placed correctly on the map?" needs the map in front of the person
// answering. This shows the map the location is on with its anchor and
// label highlighted and every other label muted, and the device's own
// position when the map can place it; the question sits UNDER the map, and
// only when there is something to ask about - a location that is not on
// the map yet is simply placed (owner, 2026-10-04). Tapping the map,
// answering No, or *Place it on the map* opens the fullscreen editor
// (shared/MapLabelEditor.tsx), which zooms.
//
// What comes back from the editor is a move_placement Proposal (docs/audits.md
// § What becomes a Proposal), never a write: every other user navigates by
// that map. Moving a label that was there answers No.

export type ProposedPlacement = MapPlacement;

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
  /** A new placement, and - when moving a label that was on the map - the
   *  answer No that comes with it, in ONE call: two calls from the same
   *  event each rebuilt the caller's state from what it held before the
   *  other, and the second wiped out the first (2026-10-05). */
  onPropose: (p: ProposedPlacement | null, answer?: boolean) => void;
  /** The answer to "placed correctly?", asked only when it is placed. */
  answer: boolean | null;
  onAnswer: (v: boolean) => void;
  /** The wizard's one-item-per-screen size. */
  big?: boolean;
}) {
  const [chosenMapId, setChosenMapId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { maps, map, anchor: savedAnchor, label: savedLabel, anchors, labels } = useLocationMap(locationId, proposed?.map_id ?? chosenMapId);
  const fit = useMapFit(map?.id);
  const device = useDevicePosition();

  const saved = { anchor: savedAnchor ? { cx: savedAnchor.cx, cy: savedAnchor.cy } : null, label: savedLabel ? labelShapeOf(savedLabel) : null };
  /** Where it is, as far as this check knows: the proposal wins. */
  const here = proposed && map && proposed.map_id === map.id ? proposed : null;
  const anchor: MapPoint | null = here ? (here.anchor ?? saved.anchor) : saved.anchor;
  const label: LabelShape | null = here ? (here.label ?? saved.label) : saved.label;
  const placed = anchor !== null || label !== null;

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
        <span className="muted small">{savedAnchor || savedLabel ? `On ${map.scope_name ?? map.name}` : proposed ? "Placed in this audit - waits for approval" : "Not on any map yet."}</span>
        {maps.length > 1 && editable && !placed && (
          <select className="select select-inline" value={map.id} onChange={(e) => setChosenMapId(e.target.value)} aria-label="Which map">
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.scope_name ?? m.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <MapPreview
        map={map}
        anchors={anchors}
        labels={labels}
        subject={{ locationId, name: locationName }}
        anchor={anchor}
        label={label}
        proposed={proposed !== null}
        fit={fit}
        device={device}
        onOpen={editable ? () => setEditing(true) : undefined}
        testId="pc-preview"
      />

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
          anchors={anchors}
          labels={labels}
          subject={{ locationId, name: locationName }}
          anchor={anchor}
          label={label}
          fit={fit}
          removable={proposed !== null}
          removeLabel="Discard the proposal"
          onCancel={() => setEditing(false)}
          onRemove={() => {
            setEditing(false);
            onPropose(null);
          }}
          onDone={(next) => {
            setEditing(false);
            // Finishing where it already is proposes nothing.
            if (!proposed && samePoint(next.anchor, saved.anchor) && sameLabel(next.label, saved.label)) return;
            // Moving a label that was on the map says it was not placed
            // correctly. Placing one that was not on the map says nothing:
            // the question was never asked.
            onPropose({ map_id: map.id, anchor: next.anchor, label: next.label }, saved.label || saved.anchor ? false : undefined);
          }}
        />
      )}
    </div>
  );
}

function samePoint(a: MapPoint | null, b: MapPoint | null): boolean {
  return (a === null && b === null) || (a !== null && b !== null && a.cx === b.cx && a.cy === b.cy);
}
function sameLabel(a: LabelShape | null, b: LabelShape | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = ["cx", "cy", "rotation", "fontSize", "paddingX", "paddingY"] as const;
  return (
    keys.every((k) => (a[k] ?? null) === (b[k] ?? null)) &&
    JSON.stringify(a.outline ?? null) === JSON.stringify(b.outline ?? null) &&
    (a.showText !== false) === (b.showText !== false)
  );
}
