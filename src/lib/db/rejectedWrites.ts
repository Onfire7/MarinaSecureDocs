import { useSyncExternalStore } from "react";

// Writes the office refused for good, kept where a reload cannot lose them.
//
// The connector discards such a write so that it cannot block every write
// queued behind it. That is right. Doing it with a console.error and nothing
// else was not: the person whose work it was never found out. This is the
// record the save indicator shows until someone dismisses it.
//
// localStorage rather than a table: it must work when the database is the
// thing misbehaving, and it needs no schema during a schema freeze.

export interface RejectedWrite {
  table: string;
  op: string;
  code: string;
  message: string;
  at: string;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "marinasecure.rejectedWrites";
const MAX = 50;

let storage: Storage | null =
  typeof localStorage === "undefined" ? null : localStorage;
let cache: RejectedWrite[] | null = null;
const listeners = new Set<() => void>();

/** Tests substitute an in-memory store; null simulates storage being denied. */
export function setRejectedWriteStorage(s: Storage | null) {
  storage = s;
  cache = null;
}

export function listRejectedWrites(): RejectedWrite[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? (parsed as RejectedWrite[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(next: RejectedWrite[]) {
  cache = next;
  try {
    if (next.length) storage?.setItem(KEY, JSON.stringify(next));
    else storage?.removeItem(KEY);
  } catch {
    // Storage full or denied. The in-memory copy still drives the indicator
    // for this session, which is the most that can be done.
  }
  for (const l of listeners) l();
}

export function recordRejectedWrite(w: Omit<RejectedWrite, "at">) {
  save([...listRejectedWrites(), { ...w, at: new Date().toISOString() }].slice(-MAX));
}

export function dismissRejectedWrites() {
  save([]);
}

export function useRejectedWrites(): RejectedWrite[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    listRejectedWrites,
  );
}
