// Where the device is on a map (docs/maps.md): a dot with the accuracy
// around it, placed through the map's fit. Blue inside the calibrated
// area; grey, and labelled, when the fit had to extrapolate; nothing at all
// when there is no fit or no fix - a dot that might be anywhere is worse
// than none. Rendered inside a `.map-canvas` (or the editor's map layer),
// in percent, so it scales with the image. The dot itself stays dot-sized
// at any zoom through the `--zs` variable the zoomable layers set.
import type { MapFit } from "../../lib/mapFit";
import type { DevicePosition } from "./useDevicePosition";

export function DeviceDot({ fit, position }: { fit: MapFit | null; position: DevicePosition | null }) {
  if (!fit || !position) return null;
  const at = fit.toMap(position.lat, position.lng);
  if (!Number.isFinite(at.cx) || !Number.isFinite(at.cy)) return null;
  const r = fit.radiusAt(position.lat, position.lng, position.accuracy);
  return (
    <>
      <span
        className={`map-device-ring ${at.inside ? "" : "outside"}`}
        style={{ left: `${at.cx}%`, top: `${at.cy}%`, width: `${Math.max(0.5, r.rx * 2)}%`, height: `${Math.max(0.5, r.ry * 2)}%` }}
        aria-hidden
      />
      <span
        className={`map-device-dot ${at.inside ? "" : "outside"}`}
        style={{ left: `${at.cx}%`, top: `${at.cy}%` }}
        data-testid="device-dot"
        data-inside={at.inside ? "1" : "0"}
        title={at.inside ? `You, ±${Math.round(position.accuracy)} m` : "You - outside the part of the map that has been calibrated"}
      />
    </>
  );
}
