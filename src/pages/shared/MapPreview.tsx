// A map at a glance, with one location picked out (docs/maps.md): its
// label and, when the label has been moved off it, its anchor; every other
// label muted; the device's own position when the map's fit can place it.
// Not an editor - tapping it opens one. The placement check and the admin
// location row both show this.
import { placementStyle, type PlacementShape } from "../../lib/locations";
import type { MapFit } from "../../lib/mapFit";
import { placementOf, type MarinaMapRow, type PlacementRow } from "../../data/locations";
import { attachmentUrl } from "../../data/files";
import { DeviceDot } from "./DeviceDot";
import type { DevicePosition } from "./useDevicePosition";

export function MapPreview({
  map,
  placements,
  subject,
  shape,
  proposed,
  fit,
  device,
  onOpen,
  testId = "map-preview",
}: {
  map: MarinaMapRow;
  placements: PlacementRow[];
  subject: { locationId: string; name: string };
  /** Where the subject is drawn, or null when it is not on this map. */
  shape: PlacementShape | null;
  /** Draw the subject as a proposal awaiting approval. */
  proposed?: boolean;
  fit: MapFit | null;
  device: DevicePosition | null;
  onOpen?: () => void;
  testId?: string;
}) {
  const imageUrl = attachmentUrl(map.image_path);
  return (
    <div
      className={`map-canvas map-schematic pc-preview ${onOpen ? "pc-tappable" : ""}`}
      data-testid={testId}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      aria-label={onOpen ? "Open the map" : undefined}
    >
      {imageUrl && <img src={imageUrl} alt={map.name} className="map-image" />}
      {placements
        .filter((p) => p.location_id !== subject.locationId)
        .map((p) => (
          <span key={p.id} className="map-rect pc-other" style={placementStyle(placementOf(p))}>
            {p.location_name}
          </span>
        ))}
      <DeviceDot fit={fit} position={device} />
      {shape && (
        <>
          <span className={`map-rect pc-mine ${proposed ? "pc-proposed-label" : ""}`} style={placementStyle(shape)} title={proposed ? "Proposed placement — waits for approval" : undefined} data-testid={`${testId}-label`}>
            {subject.name}
          </span>
          {shape.dx || shape.dy ? <span className="map-anchor" style={{ left: `${shape.cx}%`, top: `${shape.cy}%` }} title={`${subject.name} is here`} data-testid={`${testId}-anchor`} /> : null}
        </>
      )}
      {onOpen && <span className="pc-zoom-hint">tap to zoom</span>}
    </div>
  );
}
