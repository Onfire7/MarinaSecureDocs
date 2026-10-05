import { useMemo, useState } from "react";
import { placementStyle, type PlacementShape } from "../../lib/locations";
import { placementOf, useLocations, useMarinaMaps, usePlacements } from "../../data/locations";
import { attachmentUrl } from "../../data/files";
import { MapLabelEditor } from "../shared/MapLabelEditor";

// "Is it placed correctly on the map?" needs the map in front of the person
// answering. This shows the map the location is plotted on with its
// rectangle highlighted and every other one muted; the question sits UNDER
// the map, and only when there is a placement to ask about - a location
// that is not on the map yet is simply placed (owner, 2026-10-04). Tapping
// the map, answering No, or *Place it on the map* opens the fullscreen
// editor (shared/MapLabelEditor.tsx), which zooms.
//
// What comes back from the editor is a move_placement Proposal (docs/audits.md
// § What becomes a Proposal), never a write: every other user navigates by
// that map. Making one answers No.
//
// A location plotted on no map offers the map of its nearest ancestor that
// has one, so a slip added in the field can be placed on its dock's map.

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
  const { data: maps } = useMarinaMaps();
  const { data: placements } = usePlacements();
  const { data: locations } = useLocations();
  const [chosenMapId, setChosenMapId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const own = placements.find((p) => p.location_id === locationId) ?? null;
  // The map to show: the one it's on, the one proposed, or the nearest
  // ancestor's map so an unplotted location can be placed.
  const fallbackMap = useMemo(() => {
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
  const activeMapId = proposed?.map_id ?? chosenMapId ?? own?.map_id ?? fallbackMap?.id ?? null;
  const map = maps.find((m) => m.id === activeMapId) ?? null;
  const imageUrl = map ? attachmentUrl(map.image_path) : null;
  const shown = placements.filter((p) => p.map_id === activeMapId);
  const ownShape = own && own.map_id === activeMapId ? placementOf(own) : null;
  /** Where it is, as far as this check knows: the proposal wins. */
  const current: PlacementShape | null = proposed && proposed.map_id === activeMapId ? proposed.placement : ownShape;
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
        <span className="muted small">{own ? `Plotted on ${map.scope_name ?? map.name}` : "Not on any map yet."}</span>
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
        {shown.map((p) => {
          const mine = p.location_id === locationId;
          if (mine && proposed) return null;
          return (
            <span
              key={p.id}
              className="map-rect"
              style={{
                ...placementStyle(placementOf(p)),
                opacity: mine ? 1 : 0.45,
                background: mine ? "var(--accent-soft)" : "var(--panel)",
                borderColor: mine ? "var(--accent)" : "var(--line)",
                borderWidth: 1,
                color: "var(--ink)",
                fontWeight: mine ? 700 : 400,
                pointerEvents: "none",
              }}
            >
              {p.location_name}
            </span>
          );
        })}
        {proposed && proposed.map_id === map.id && (
          <span
            className="map-rect"
            style={{
              ...placementStyle(proposed.placement),
              background: "var(--warn-bg)",
              borderColor: "var(--warn)",
              borderWidth: 1,
              color: "var(--ink)",
              fontWeight: 700,
              pointerEvents: "none",
            }}
            title="Proposed placement — waits for approval"
          >
            {locationName}
          </span>
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
          placements={shown}
          subject={{ locationId, name: locationName }}
          shape={current}
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
  const keys = ["cx", "cy", "rotation", "fontSize", "paddingX", "paddingY"] as const;
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
