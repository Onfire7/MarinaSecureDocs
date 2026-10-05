// The device's position, watched once for the whole signed-in app (owner,
// 2026-10-05): the maps, the GPS capture and the nearest-first lists all
// read the same fix instead of each starting a watch and waiting for the
// first one. The watch runs while the app is in the foreground and stops
// while the tab is hidden, so a phone in a pocket is not running the GPS
// for a page nobody is looking at. `useDevicePosition` subscribes to it.
import { useSyncExternalStore } from "react";

export interface DevicePosition {
  lat: number;
  lng: number;
  /** Metres, as the device reports it. */
  accuracy: number;
  /** When the fix was taken, ms since the epoch. */
  at: number;
}

let current: DevicePosition | null = null;
let watchId: number | null = null;
let wanted = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function begin() {
  if (watchId !== null || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      current = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp };
      emit();
    },
    () => {
      // Denied, or no fix for a while: say so rather than show a stale one.
      current = null;
      emit();
    },
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
  );
}

function end() {
  if (watchId === null) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function onVisibility() {
  if (!wanted) return;
  if (document.visibilityState === "visible") begin();
  else end();
}

/** Start watching for as long as the app is open and visible. Returns the
 *  stop, for the component that owns the watch. */
export function startDevicePositionWatch(): () => void {
  wanted = true;
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") begin();
  } else begin();
  return () => {
    wanted = false;
    document.removeEventListener("visibilitychange", onVisibility);
    end();
  };
}

export function subscribeDevicePosition(listener: () => void): () => void {
  listeners.add(listener);
  // A reader that mounts before the app-wide watch (a dialog opened from a
  // deep link) still gets a fix.
  if (!wanted && watchId === null) begin();
  return () => {
    listeners.delete(listener);
  };
}

export function getDevicePosition(): DevicePosition | null {
  return current;
}

/** The latest fix the app has, or null until there is one. */
export function useDevicePosition(enabled = true): DevicePosition | null {
  const pos = useSyncExternalStore(subscribeDevicePosition, getDevicePosition, () => null);
  return enabled ? pos : null;
}
