import { useState } from "react";
import type { LabelShape, MapPoint } from "../../lib/locations";
import type { MapPlacement } from "../../lib/auditWizard";
import { labelShapeOf } from "../../data/locations";
import { useLocationMap, useMapFit } from "../../data/maps";
import { MapLabelEditor } from "../shared/MapLabelEditor";
import { MapPreview } from "../shared/MapPreview";
import { useDevicePosition } from "../shared/useDevicePosition";

// The audit's map check - a look, not a question (owner, 2026-10-19,
// replacing *Is it placed correctly on the map?*). A location may be on
// several maps (docs/maps.md § A location on several maps), so it opens
// with a chooser of every map, ✓ where the location is on it - saved, or
// changed in this audit - on its default map. Under it the chosen map with
// the anchor and label highlighted, every other label muted, and the
// device's own position when the map can place it; *Place it on this map*
// or *Adjust*, or a tap on the map, opens the fullscreen editor
// (shared/MapLabelEditor.tsx). **Done** is the page's answer.
//
// What comes back from the editor is a move_placement Proposal per map
// (docs/audits.md § What becomes a Proposal), never a write: every other
// user navigates by those maps. Placing it on a map it is not on adds it
// there; nothing here takes it off one.

export type ProposedPlacement = MapPlacement;

export function PlacementCheck({
  locationId,
  locationName,
  editable,
  placements,
  onPlacement,
  onDiscard,
  done,
  onDone,
  big,
}: {
  locationId: string;
  locationName: string;
  editable: boolean;
  /** This audit's change on each map, one per map. */
  placements: ProposedPlacement[];
  /** A change on one map, replacing that map's last. */
  onPlacement: (p: ProposedPlacement) => void;
  onDiscard: (mapId: string) => void;
  /** Done tapped - the page's only answer. */
  done: boolean;
  onDone: () => void;
  /** The wizard's one-item-per-screen size. */
  big?: boolean;
}) {
  const [chosenMapId, setChosenMapId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { maps, map, onMapIds, anchor: savedAnchor, label: savedLabel, anchors, labels } = useLocationMap(locationId, chosenMapId);
  const fit = useMapFit(map?.id);
  const device = useDevicePosition();

  if (!map) {
    return <div className="muted small">No marina map is uploaded, so placement cannot be checked here.</div>;
  }

  const saved = { anchor: savedAnchor ? { cx: savedAnchor.cx, cy: savedAnchor.cy } : null, label: savedLabel ? labelShapeOf(savedLabel) : null };
  /** This audit's change on the map shown, which wins over what is saved. */
  const here = placements.find((p) => p.map_id === map.id) ?? null;
  const anchor: MapPoint | null = here ? (here.anchor ?? saved.anchor) : saved.anchor;
  const label: LabelShape | null = here ? (here.label ?? saved.label) : saved.label;
  const placed = anchor !== null || label !== null;
  const marked = new Set([...onMapIds, ...placements.map((p) => p.map_id)]);
  const nameOf = (m: { name: string; scope_name: string | null }) => m.scope_name ?? m.name;

  return (
    <div className="pc">
      <div className="pc-status">
        <select
          className="select select-inline"
          value={map.id}
          disabled={maps.length < 2}
          onChange={(e) => setChosenMapId(e.target.value)}
          aria-label="Which map"
          data-testid="pc-map"
        >
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {marked.has(m.id) ? "✓ " : ""}
              {nameOf(m)}
            </option>
          ))}
        </select>
        <span className="muted small" data-testid="pc-here">
          {here ? "Changed in this audit - waits for approval" : placed ? "On this map" : "Not on this map"}
        </span>
      </div>
      <MapPreview
        map={map}
        anchors={anchors}
        labels={labels}
        subject={{ locationId, name: locationName }}
        anchor={anchor}
        label={label}
        proposed={here !== null}
        fit={fit}
        device={device}
        onOpen={editable ? () => setEditing(true) : undefined}
        testId="pc-preview"
      />

      {editable && (
        <div className="chip-row" style={{ marginBottom: 0, justifyContent: big ? "center" : undefined }}>
          {placed ? (
            <button type="button" className={`btn ${big ? "wz-btn-big" : "btn-sm"}`} data-testid="pc-adjust" onClick={() => setEditing(true)}>
              Adjust
            </button>
          ) : (
            <button type="button" className={`btn ${big ? "wz-btn-big" : "btn-sm"}`} data-testid="pc-place" onClick={() => setEditing(true)}>
              Place it on this map
            </button>
          )}
          <button type="button" className={`btn btn-primary ${big ? "wz-btn-big" : "btn-sm"} ${done ? "tree-match" : ""}`} data-testid="pc-done" onClick={onDone}>
            {done ? "Done ✓" : "Done"}
          </button>
        </div>
      )}
      {here && (
        <div className="pc-proposed">
          <span className="badge badge-warn">Change on {nameOf(map)} proposed - waits for approval</span>
          {editable && (
            <button type="button" className="btn btn-sm btn-bare" data-testid="pc-discard" onClick={() => onDiscard(map.id)}>
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
          removable={here !== null}
          removeLabel="Discard the change"
          onCancel={() => setEditing(false)}
          onRemove={() => {
            setEditing(false);
            onDiscard(map.id);
          }}
          onDone={(next) => {
            setEditing(false);
            // Finishing where it already is proposes nothing.
            if (!here && samePoint(next.anchor, saved.anchor) && sameLabel(next.label, saved.label)) return;
            onPlacement({ map_id: map.id, anchor: next.anchor, label: next.label });
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
