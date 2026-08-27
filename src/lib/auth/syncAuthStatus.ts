import { useSyncExternalStore } from "react";

// Whether the app's connection to the marina's database has been *refused* —
// as opposed to merely being offline.
//
// The distinction is the whole reason this file exists. Under InstantDB, a
// rejected Clerk token exchange ("Unauthorized origin") made every query run
// anonymously; the permission rules then denied them, and the empty result
// surfaced in the UI as "This account can't access this marina" — a
// provisioning message for what was a configuration failure. That sent a
// debugging session down entirely the wrong road.
//
// The same trap exists on this stack, in two new places, which is why the
// store survived the migration:
//
//   * PowerSync rejects the Clerk JWT if its JWKS URL or audience is
//     misconfigured. Nothing syncs, so every table is empty.
//   * Supabase accepts the JWT but has no third-party auth provider
//     configured for Clerk, so every RLS policy evaluates against a null
//     identity and every write is silently refused.
//
// Both look exactly like an unprovisioned account. Neither is.

let error: string | null = null;
const listeners = new Set<() => void>();

/** Record a connection failure, or clear it with null once one succeeds. */
export function setSyncAuthError(message: string | null) {
  if (error === message) return;
  error = message;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return error;
}

/** Last connection failure message, or null once a connection succeeds. */
export function useSyncAuthError(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
