import { useSyncExternalStore } from "react";

// Whether the Clerk → Instant token exchange (signInWithIdToken) has been
// rejected. InstantAuthSync used to swallow this with a console.warn on the
// theory that failures meant "offline" — but a *rejected* exchange (e.g.
// "Validation failed for origin: Unauthorized origin" when the browser's
// origin isn't in the Instant app's allowed origins) means every query runs
// anonymously, which permission rules then deny. That surfaced in the UI as
// "This account can't access this marina" — a provisioning message for what
// is actually a configuration failure — and sent debugging down the wrong
// road entirely. This tiny store lets the auth gates tell those apart.

let error: string | null = null;
const listeners = new Set<() => void>();

export function setInstantAuthError(message: string | null) {
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

/** Last signInWithIdToken failure message, or null once one succeeds. */
export function useInstantAuthError(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
