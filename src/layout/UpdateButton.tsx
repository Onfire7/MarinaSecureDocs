import { useSyncExternalStore } from "react";
import {
  appUpdateReady,
  applyAppUpdate,
  subscribeAppUpdate,
} from "../lib/appUpdate";

/**
 * Appears only when a new build is sitting in the service worker, waiting.
 *
 * The app precaches its whole bundle, so an installed copy keeps serving the
 * version it cached until the worker is replaced. That used to happen
 * silently on the next launch, which meant the run where you noticed a
 * missing change was reliably the run that didn't have it yet.
 *
 * Registration lives in lib/appUpdate, not here — see the note there on why
 * it can't be a component's job.
 */
export function UpdateButton() {
  const ready = useSyncExternalStore(subscribeAppUpdate, appUpdateReady);
  if (!ready) return null;
  return (
    <button
      type="button"
      className="btn btn-sm btn-update"
      title="A new version is ready"
      onClick={() => void applyAppUpdate()}
    >
      Update
    </button>
  );
}
