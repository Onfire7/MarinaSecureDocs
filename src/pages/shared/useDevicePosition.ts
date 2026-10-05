// The device's position, watched for as long as the caller is mounted.
// One hook for the GPS capture, the device dot on every map and the map
// editor, so a screen that shows two of them shares nothing but the
// browser's own watch. Null until the first fix, and again after an error.
import { useEffect, useState } from "react";

export interface DevicePosition {
  lat: number;
  lng: number;
  /** Metres, as the device reports it. */
  accuracy: number;
}

export function useDevicePosition(enabled = true): DevicePosition | null {
  const [pos, setPos] = useState<DevicePosition | null>(null);
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => setPos(null),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return enabled ? pos : null;
}
