import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { nfcErrorMessage, nfcWriteSupported, vibrateWriteAck, writeNfcUrl } from "../../lib/nfc";

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
  const { t } = useTranslation(["shared", "common"]);
  const supported = nfcWriteSupported();
  const [status, setStatus] = useState<"idle" | "writing" | "success" | "error">(
    supported ? "idle" : "error",
  );
  const [errorMessage, setErrorMessage] = useState(
    supported
      ? ""
      : t("nfc.unsupported"),
  );
  const controllerRef = useRef<AbortController | null>(null);

  const start = async () => {
    setStatus("writing");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await writeNfcUrl(url, controller.signal);
      vibrateWriteAck();
      setStatus("success");
    } catch (err) {
      // Aborting (Cancel below) rejects the write too — that's the user's
      // own action, not a failure worth reporting.
      if (controller.signal.aborted) {
        setStatus("idle");
        return;
      }
      setErrorMessage(nfcErrorMessage(err, t));
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
          {t("nfc.title", { name: checkpointName })}
        </div>

        {status === "idle" && (
          <>
            <p className="muted small">
              {t("nfc.instructions")}
            </p>
            <code
              className="small muted"
              style={{ wordBreak: "break-all", display: "block", margin: "8px 0" }}
            >
              {url}
            </code>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void start()}>
                {t("nfc.write")}
              </button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                {t("common:cancel")}
              </button>
            </div>
          </>
        )}

        {status === "writing" && (
          <>
            <div className="badge badge-accent" style={{ display: "block", marginBottom: 10 }}>
              {t("nfc.waiting")}
            </div>
            <div className="row">
              <button type="button" className="btn btn-quiet" onClick={cancel}>
                {t("common:cancel")}
              </button>
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <div className="badge badge-good" style={{ display: "block", marginBottom: 10 }}>
              {t("nfc.written")}
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={() => setStatus("idle")}>
                {t("nfc.another")}
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                {t("common:done")}
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
                  {t("nfc.tryAgain")}
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                {t("common:close")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
