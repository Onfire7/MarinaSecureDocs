// A map at a glance, with one location picked out (docs/maps.md): its
// label, its anchor where that stands apart from the label, every other
// label muted, the free calibration points, and the device's own position
// when the map's fit can place it. Not an editor - tapping it opens one.
// The placement check, the wizard's GPS page and the admin row show this.
import { placementStyle, type LabelShape, type MapPoint } from "../../lib/locations";
import type { MapFit } from "../../lib/mapFit";
import { labelShapeOf, type MapAnchorRow, type MapLabelRow, type MarinaMapRow } from "../../data/locations";
import { attachmentUrl } from "../../data/files";
import { DeviceDot } from "./DeviceDot";
import type { DevicePosition } from "./useDevicePosition";
import { useMapShow } from "./mapShow";
import { MapShowToggle } from "./MapShowToggle";
import { ZoomableMap } from "./ZoomableMap";

export function MapPreview({
  map,
  anchors,
  labels,
  subject,
  anchor,
  label,
  proposed,
  fit,
  device,
  marks = [],
  onOpen,
  testId = "map-preview",
}: {
  map: MarinaMapRow;
  anchors: MapAnchorRow[];
  labels: MapLabelRow[];
  subject: { locationId: string; name: string };
  anchor: MapPoint | null;
  label: LabelShape | null;
  /** Draw the subject as a proposal awaiting approval. */
  proposed?: boolean;
  fit: MapFit | null;
  device: DevicePosition | null;
  /** GPS positions to mark through the fit - the pin on file, a fix just
   *  captured. Drawn only when the fit can place them. */
  marks?: { lat: number; lng: number; kind: "pin" | "fix"; title: string }[];
  onOpen?: () => void;
  testId?: string;
}) {
  const imageUrl = attachmentUrl(map.image_path);
  const show = useMapShow();
  const showLabels = show.labels;
  const showAnchors = show.anchors;
  // With both on, a located anchor is drawn only where it stands apart
  // from its label; with anchors alone, every one.
  const apart = anchor && label ? Math.hypot(label.cx - anchor.cx, label.cy - anchor.cy) > 0.5 : anchor !== null;
  return (
    <ZoomableMap
      imageUrl={imageUrl}
      alt={map.name}
      className={`map-canvas map-schematic pc-preview ${onOpen ? "pc-tappable" : ""}`}
      onClick={onOpen}
      testId={testId}
      overlay={
        <>
          <div className="pc-toolbar">
            <MapShowToggle compact />
          </div>
          {onOpen && <span className="pc-zoom-hint">tap to edit · pinch to zoom</span>}
        </>
      }
    >
      {showLabels &&
        labels
          .filter((b) => b.location_id !== subject.locationId)
          .map((b) => (
            <span key={b.id} className="map-rect pc-other" style={placementStyle(labelShapeOf(b))}>
              {b.location_name}
            </span>
          ))}
      {showAnchors &&
        anchors
          .filter((a) => a.location_id === null || (!show.labels && a.location_id !== subject.locationId))
          .map((a) => (
            <span
              key={a.id}
              className={`map-anchor ${a.location_id === null ? "map-anchor-free" : "map-anchor-other"}`}
              style={{ left: `${a.cx}%`, top: `${a.cy}%` }}
              title={a.location_id === null ? (a.label ?? "Calibration point") : (a.location_name ?? "")}
              aria-hidden
            />
          ))}
      <DeviceDot fit={fit} position={device} />
      {fit &&
        marks.map((m, i) => {
          const at = fit.toMap(m.lat, m.lng);
          if (!Number.isFinite(at.cx) || !Number.isFinite(at.cy)) return null;
          return <span key={i} className={`map-mark map-mark-${m.kind} ${at.inside ? "" : "outside"}`} style={{ left: `${at.cx}%`, top: `${at.cy}%` }} title={m.title} data-testid={`${testId}-mark-${m.kind}`} />;
        })}
      {showLabels && label && (
        <span className={`map-rect pc-mine ${proposed ? "pc-proposed-label" : ""}`} style={placementStyle(label)} title={proposed ? "Proposed placement — waits for approval" : undefined} data-testid={`${testId}-label`}>
          {subject.name}
        </span>
      )}
      {showAnchors && anchor && (apart || !showLabels) && (
        <span className="map-anchor" style={{ left: `${anchor.cx}%`, top: `${anchor.cy}%` }} title={`${subject.name} is here`} data-testid={`${testId}-anchor`} />
      )}
    </ZoomableMap>
  );
}
