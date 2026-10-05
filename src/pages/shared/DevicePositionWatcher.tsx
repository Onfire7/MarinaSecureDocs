// Owns the app-wide position watch (devicePosition.ts): mounted once,
// inside the signed-in app, so the first screen that needs a fix already
// has one and nothing asks for the permission before sign-in.
import { useEffect } from "react";
import { startDevicePositionWatch } from "./devicePosition";

export function DevicePositionWatcher() {
  useEffect(() => startDevicePositionWatch(), []);
  return null;
}
