import { useMemo, useRef, useState } from "react";
import { placementStyle, type PlacementShape } from "../../lib/locations";
import { placementOf, useLocations, useMarinaMaps, usePlacements } from "../../data/locations";
import { attachmentUrl } from "../../data/files";

// "Is it placed correctly on the map?" needs the map in front of the person
// answering. This shows the map the location is plotted on with its rectangle
// highlighted and every other rectangle muted, and lets the auditor tap where
// it should be. The tap is a move_placement Proposal (docs/audits.md § What
// becomes a Proposal), never a write: every other user navigates by that map.
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
}: {
  locationId: string;
  locationName: string;
  editable: boolean;
  proposed: ProposedPlacement | null;
  onPropose: (p: ProposedPlacement | null) => void;
}) {
  const { data: maps } = useMarinaMaps();
  const { data: placements } = usePlacements();
  const { data: locations } = useLocations();
  const [moving, setMoving] = useState(false);
  const [chosenMapId, setChosenMapId] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

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
  const ownShape = own ? placementOf(own) : null;

  if (!map) {
    return <div className="muted small">No marina map is uploaded, so placement cannot be checked here.</div>;
  }

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!moving || !editable || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const cx = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const cy = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    onPropose({ map_id: map.id, placement: { ...(ownShape ?? { rotation: 0 }), cx: +cx.toFixed(2), cy: +cy.toFixed(2) } });
    setMoving(false);
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 6, alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="muted small">
          {own ? `Plotted on ${map.scope_name ?? map.name}` : `Not plotted on any map. Showing ${map.scope_name ?? map.name}.`}
        </span>
        {maps.length > 1 && editable && (
          <select className="select select-inline" value={map.id} onChange={(e) => setChosenMapId(e.target.value)}>
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.scope_name ?? m.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div
        className="map-canvas map-schematic"
        onClick={tap}
        style={{ cursor: moving ? "crosshair" : undefined, outline: moving ? "2px dashed var(--accent)" : undefined }}
      >
        {imageUrl && <img ref={imgRef} src={imageUrl} alt={map.name} className="map-image" />}
        {shown.map((p) => {
          const mine = p.location_id === locationId;
          const dimmed = mine && proposed !== null;
          return (
            <span
              key={p.id}
              className="map-rect"
              style={{
                ...placementStyle(placementOf(p)),
                opacity: mine ? (dimmed ? 0.35 : 1) : 0.45,
                background: mine ? "var(--accent-soft)" : "var(--panel)",
                borderColor: mine ? "var(--accent)" : "var(--line)",
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
              color: "var(--ink)",
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {locationName} (proposed)
          </span>
        )}
      </div>
      {editable && (
        <div className="row" style={{ marginTop: 6, gap: 6, alignItems: "center" }}>
          {moving ? (
            <>
              <span className="muted small">Tap where {locationName} actually is.</span>
              <button type="button" className="btn btn-sm btn-bare" onClick={() => setMoving(false)}>
                cancel
              </button>
            </>
          ) : proposed ? (
            <>
              <span className="badge badge-warn">New placement proposed - waits for approval</span>
              <button type="button" className="btn btn-sm btn-bare" onClick={() => onPropose(null)}>
                discard
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => setMoving(true)}>
              {own ? "Move it on the map" : "Place it on the map"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
