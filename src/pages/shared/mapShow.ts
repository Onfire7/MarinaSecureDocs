// What a map shows: anchors, labels, or both (owner, 2026-10-06). One
// choice for every map in the app, remembered on this device, so flipping
// it on the plotter is how the location list looks too.
import { useSyncExternalStore } from "react";

export type MapShow = "anchors" | "labels" | "both";
const KEY = "marinasecure.mapShow";
const listeners = new Set<() => void>();
let current: MapShow = read();

function read(): MapShow {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    return v === "anchors" || v === "labels" || v === "both" ? v : "both";
  } catch {
    return "both";
  }
}

export function setMapShow(v: MapShow) {
  current = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // forgetting is the worst case
  }
  for (const l of listeners) l();
}

export function useMapShow(): MapShow {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => "both",
  );
}
