import { useEffect, useRef, useState } from "react";
import { useStatus } from "@powersync/react";
import { useUploadQueue } from "../data/sync";
import { dismissRejectedWrites, useRejectedWrites } from "../lib/db/rejectedWrites";
import { errorMessage } from "../lib/db/syncErrors";
import { saveState } from "../lib/saveState";

/**
 * Whether what a guard just did has reached the office.
 * Spec: SaveIndicator.spec.md, beside this file.
 */
export function SaveIndicator() {
  const status = useStatus();
  const queued = useUploadQueue();
  const rejected = useRejectedWrites();
  const [open, setOpen] = useState(false);

  // PowerSync takes tens of seconds to notice a dropped network, and for that
  // long would have this read "Sending…" to a guard who has just walked into a
  // dead spot. The browser knows at once, so connected means both agree.
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // How long the queue has gone without getting shorter. Reset whenever it
  // shrinks or empties — progress is progress, however slow.
  const mark = useRef({ queued: 0, since: Date.now() });
  const [now, setNow] = useState(() => Date.now());
  if (queued < mark.current.queued || queued === 0 || mark.current.queued === 0) {
    mark.current = { queued, since: Date.now() };
  } else {
    mark.current.queued = queued;
  }
  useEffect(() => {
    if (queued === 0) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [queued]);

  const uploadError = status.dataFlowStatus.uploadError;
  const state = saveState({
    queued,
    connected: status.connected && online,
    uploading: status.dataFlowStatus.uploading ?? false,
    uploadError: uploadError ? errorMessage(uploadError) : null,
    unchangedForMs: Math.max(0, now - mark.current.since),
    rejected: rejected.length,
  });

  return (
    <>
      <button
        type="button"
        className={"save-indicator save-" + state.tone}
        onClick={() => setOpen(true)}
        title="Tap for details"
      >
        {state.label}
      </button>
      {open && (
        <div className="dialog-backdrop" onClick={() => setOpen(false)}>
          <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title">{state.label}</div>
            <p className="muted small" style={{ marginTop: 8 }}>
              {state.kind === "sent"
                ? "Everything done on this device has reached the office."
                : state.kind === "waiting"
                  ? "Your work is saved on this device and will send by itself when there's a connection. Nothing is lost by waiting."
                  : state.kind === "sending"
                    ? "Saved on this device; sending to the office now."
                    : state.kind === "stuck"
                      ? "Your work is saved on this device, but it isn't reaching the office. Keep the app installed and signed in, and show this to whoever maintains it:"
                      : "The office refused these changes for good, so they were not saved there. Anything listed here may need doing again."}
            </p>
            {state.kind === "stuck" && state.detail && (
              <pre className="small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {state.detail}
              </pre>
            )}
            {rejected.map((w) => (
              <div key={w.at + w.table} className="small" style={{ marginTop: 8 }}>
                <strong>{w.table.replace(/_/g, " ")}</strong> ·{" "}
                {new Date(w.at).toLocaleString()}
                <div className="muted" style={{ wordBreak: "break-word" }}>
                  {w.message || w.code} ({w.code})
                </div>
              </div>
            ))}
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              {rejected.length > 0 && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    dismissRejectedWrites();
                    setOpen(false);
                  }}
                >
                  Dismiss
                </button>
              )}
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
