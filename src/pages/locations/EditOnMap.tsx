// "Edit on map" from the Locations map's card (LocationListPage.spec.md):
// the shared editor on the map being looked at, for a user with
// manage_locations, so a location's label, outline (its mask) or anchor can
// be changed where it was noticed rather than in Admin. Saves directly,
// like the admin row (data/maps.ts saveLocationPlace).
import { useState } from "react";
import { labelShapeOf, type LocationRow } from "../../data/locations";
import { removeLocationPlace, saveLocationPlace, useLocationMap, useMapFit } from "../../data/maps";
import { MapLabelEditor } from "../shared/MapLabelEditor";

export function EditOnMap({ location, mapId }: { location: LocationRow; mapId: string }) {
  const [open, setOpen] = useState(false);
  const { map, anchor: anchorRow, label: labelRow, anchors, labels } = useLocationMap(location.id, mapId);
  const fit = useMapFit(mapId);
  if (!map) return null;
  const onMap = anchorRow !== null || labelRow !== null;
  return (
    <>
      <button type="button" className="btn btn-sm" data-testid="map-edit" onClick={() => setOpen(true)}>
        {onMap ? "Edit on map" : "Place on map"}
      </button>
      {open && (
        <MapLabelEditor
          map={map}
          anchors={anchors}
          labels={labels}
          subject={{ locationId: location.id, name: location.name }}
          anchor={anchorRow ? { cx: anchorRow.cx, cy: anchorRow.cy } : null}
          label={labelRow ? labelShapeOf(labelRow) : null}
          fit={fit}
          coords
          point={{ name: location.name, lat: location.gps_lat, lng: location.gps_lng }}
          removable={onMap}
          removeLabel="Remove from this map"
          onCancel={() => setOpen(false)}
          onRemove={() => {
            setOpen(false);
            removeLocationPlace(anchorRow, labelRow);
          }}
          onDone={(next) => {
            setOpen(false);
            saveLocationPlace({ mapId: map.id, location, anchorRow, labelRow, next });
          }}
        />
      )}
    </>
  );
}
