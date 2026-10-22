import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStatus } from "@powersync/react";
import { useUploadQueue } from "../data/sync";
import { dismissRejectedWrites, useRejectedWrites } from "../lib/db/rejectedWrites";
import { errorMessage } from "../lib/db/syncErrors";
import { saveState } from "../lib/saveState";
import { dateTime } from "../i18n";

/**
 * Whether what a guard just did has reached the office.
 * Spec: SaveIndicator.spec.md, beside this file.
 */
export function SaveIndicator() {
  const { t } = useTranslation(["layout", "common"]);
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
  }, t);

  return (
    <>
      <button
        type="button"
        className={"save-indicator save-" + state.tone}
        onClick={() => setOpen(true)}
        title={t("save.tapForDetails")}
      >
        {state.label}
      </button>
      {open && (
        <div className="dialog-backdrop" onClick={() => setOpen(false)}>
          <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title">{state.label}</div>
            <p className="muted small" style={{ marginTop: 8 }}>
              {t(`save.explain.${state.kind}`)}
            </p>
            {state.kind === "stuck" && state.detail && (
              <pre className="small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {state.detail}
              </pre>
            )}
            {rejected.map((w) => (
              <div key={w.at + w.table} className="small" style={{ marginTop: 8 }}>
                <strong>{w.table.replace(/_/g, " ")}</strong> ·{" "}
                {dateTime(w.at)}
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
                  {t("save.dismiss")}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                {t("common:close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
