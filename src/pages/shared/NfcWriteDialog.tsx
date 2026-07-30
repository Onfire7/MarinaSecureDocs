import { useRef, useState } from "react";
import { nfcErrorMessage, nfcWriteSupported, writeNfcUrl } from "../../lib/nfc";

/**
 * Programs a blank NFC tag with a checkpoint's check-in URL. Shared between
 * the Checkpoints admin page and the checkpoint rows on Location Types &
 * Locations, so both offer the same write flow rather than diverging copies.
 */
export function NfcWriteDialog({
  checkpointName,
  url,
  onClose,
}: {
  checkpointName: string;
  url: string;
  onClose: () => void;
}) {
  const supported = nfcWriteSupported();
  const [status, setStatus] = useState<"idle" | "writing" | "success" | "error">(
    supported ? "idle" : "error",
  );
  const [errorMessage, setErrorMessage] = useState(
    supported
      ? ""
      : "NFC tag writing isn't supported in this browser. Use Chrome on Android with NFC turned on.",
  );
  const controllerRef = useRef<AbortController | null>(null);

  const start = async () => {
    setStatus("writing");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await writeNfcUrl(url, controller.signal);
      setStatus("success");
    } catch (err) {
      // Aborting (Cancel below) rejects the write too — that's the user's
      // own action, not a failure worth reporting.
      if (controller.signal.aborted) {
        setStatus("idle");
        return;
      }
      setErrorMessage(nfcErrorMessage(err));
      setStatus("error");
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
    setStatus("idle");
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Write NFC tag — {checkpointName}
        </div>

        {status === "idle" && (
          <>
            <p className="muted small">
              Hold a blank NFC tag near the back of this device, then tap Write.
              The tag will be programmed with this checkpoint's scan URL.
            </p>
            <code
              className="small muted"
              style={{ wordBreak: "break-all", display: "block", margin: "8px 0" }}
            >
              {url}
            </code>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void start()}>
                Write tag
              </button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {status === "writing" && (
          <>
            <div className="badge badge-accent" style={{ display: "block", marginBottom: 10 }}>
              Waiting for tag — hold it near the back of the device…
            </div>
            <div className="row">
              <button type="button" className="btn btn-quiet" onClick={cancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <div className="badge badge-good" style={{ display: "block", marginBottom: 10 }}>
              Tag written ✓
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={() => setStatus("idle")}>
                Write another
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div className="badge badge-bad" style={{ display: "block", marginBottom: 10 }}>
              {errorMessage}
            </div>
            <div className="row">
              {supported && (
                <button type="button" className="btn btn-primary" onClick={() => void start()}>
                  Try again
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
