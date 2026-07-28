import { useSyncExternalStore } from "react";

/**
 * PWA install prompt plumbing (see docs/pages/dashboard.html — Install app).
 *
 * `beforeinstallprompt` fires once, early — routinely before React has
 * mounted — and the browser only lets the saved event be used later if
 * preventDefault() ran synchronously in that first handler. Both facts mean
 * this has to be captured at module load, outside React, with components
 * subscribing to what was already caught rather than listening themselves.
 *
 * Nothing fires it at all on browsers without install support (Firefox, iOS
 * Safari) or when the app is already installed, which is exactly when the
 * button should stay hidden — so "is the prompt available" doubles as "is
 * the button worth showing."
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Without this the browser shows its own mini-infobar instead and the
    // event can't be replayed from a button later.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    // A prompt can only be used once, and there's nothing left to install.
    deferredPrompt = null;
    notify();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Returns the module-level ref itself, so the snapshot is identity-stable
// between notifications — useSyncExternalStore re-renders forever otherwise.
function getSnapshot(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

/** True once the browser has offered an install prompt we can replay. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot() !== null,
    () => false,
  );
}

/** Shows the native install dialog. Resolves once the user has answered. */
export async function promptInstall(): Promise<void> {
  const prompt = deferredPrompt;
  if (!prompt) return;
  // Consumed on use whatever the outcome: the browser refuses to replay the
  // same event, so keeping it would leave a button that silently does
  // nothing. A dismissal means a new event fires on some later visit.
  deferredPrompt = null;
  notify();
  await prompt.prompt();
  await prompt.userChoice;
}
