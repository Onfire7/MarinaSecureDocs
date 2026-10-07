// What a map shows: anchors, labels, either, both or neither - two
// independent switches (owner, 2026-10-07; it was one three-way choice
// the day before). One setting for every map in the app, remembered on
// this device, so flipping it on the plotter is how the location list
// looks too. With both on, a located anchor is drawn only where it stands
// apart from its label; with anchors alone, every one.
import { useSyncExternalStore } from "react";
import { parseMapShow, SHOW_BOTH, type MapShow } from "../../lib/mapShow";

export type { MapShow };

const KEY = "marinasecure.mapShow";
const listeners = new Set<() => void>();
let current: MapShow = read();

function read(): MapShow {
  try {
    return parseMapShow(typeof localStorage === "undefined" ? null : localStorage.getItem(KEY));
  } catch {
    return SHOW_BOTH;
  }
}

export function setMapShow(change: Partial<MapShow>) {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
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
    () => SHOW_BOTH,
  );
}
