import { registerSW } from "virtual:pwa-register";

/**
 * Service worker registration and the "a new build is waiting" signal.
 *
 * Registration happens at boot, from main.tsx, deliberately *outside* React:
 * put it in a component and it only runs once that component mounts, so a
 * signed-out user staring at the sign-in screen — or anyone hitting the
 * config gate — would never register a worker, and the app would stop being
 * installable or usable offline until after sign-in. It has to be a
 * module-load side effect, like the install prompt beside it.
 *
 * The waiting worker is *not* activated on its own (registerType: 'prompt'
 * in vite.config.ts). Auto-activation swapped builds on the next launch with
 * nothing on screen to say so, which made a stale app indistinguishable from
 * a bug.
 */
let needRefresh = false;
const listeners = new Set<() => void>();
let update: (reload?: boolean) => Promise<void> = async () => {};

/** Re-check hourly: a tablet left open on the dock is never relaunched. */
const UPDATE_POLL_MS = 60 * 60_000;

function announce() {
  if (needRefresh) return;
  needRefresh = true;
  for (const l of listeners) l();
}

export function initAppUpdates() {
  update = registerSW({
    onNeedRefresh: announce,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // onNeedRefresh rides on Workbox's "waiting" event, which is only
      // dispatched for an update Workbox watched install. On a reload the
      // browser routinely finishes installing the new worker before this
      // page's script runs at all — by the time we register, it is already
      // waiting and there is no event left to hear. Asking directly is the
      // only way to catch that, and it's the common case after a deploy.
      if (registration.waiting) announce();
      setInterval(() => void registration.update(), UPDATE_POLL_MS);
    },
  });
}

export function subscribeAppUpdate(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function appUpdateReady() {
  return needRefresh;
}

/**
 * Activate the waiting worker and reload. The reload matters as much as the
 * activation: until the new worker is in charge, a plain refresh is answered
 * by the old one out of the old precache.
 */
export function applyAppUpdate() {
  // The reload is ours to arrange. registerSW only wires one up inside the
  // handler for Workbox's "waiting" event — which, per the note above, is
  // exactly the path that doesn't run when the worker was already waiting.
  // controllerchange fires once the new worker takes over, either way.
  navigator.serviceWorker?.addEventListener(
    "controllerchange",
    () => window.location.reload(),
    { once: true },
  );
  return update(true);
}
