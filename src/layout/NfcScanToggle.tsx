import { useEffect, useRef, useState } from "react";
import {
  checkpointGuidFromUrl,
  nfcErrorMessage,
  nfcPermissionGranted,
  nfcReadSupported,
  scanNfcUrls,
  vibrateScanAck,
} from "../lib/nfc";

/**
 * Lets a guard arm NFC scanning for the rest of the session, so tapping a
 * checkpoint's tag while the app is already open opens it right there
 * (via `onScan`) instead of the OS handing the tag off to a new browser tab.
 * Renders nothing where Web NFC doesn't exist (everything but Chrome on
 * Android) — same capability-gated pattern as InstallAppButton.
 *
 * One "start" click is enough: scan() keeps delivering every subsequent tag
 * read until stopped, it isn't a one-shot request.
 *
 * With `autoStart`, not even that: if NFC is already allowed, scanning begins
 * on open. Only ONE mounted toggle may carry it — AppShell renders two, and
 * two readers would acknowledge every tag twice.
 */
export function NfcScanToggle({
  onScan,
  autoStart = false,
}: {
  onScan: (checkpointGuid: string) => void;
  autoStart?: boolean;
}) {
  const supported = nfcReadSupported();
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  // Stop listening if this ever unmounts (it doesn't, in practice — AppShell
  // is alive for the whole session — but a stray listener outliving its
  // component would be a real leak, not a hypothetical one).
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Declared before the early return below, as hooks must be. `start` is read
  // through a ref because it is recreated each render and this runs once.
  const startRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!autoStart || !supported) return;
    let cancelled = false;
    void nfcPermissionGranted().then((granted) => {
      if (granted && !cancelled && !controllerRef.current) void startRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [autoStart, supported]);

  if (!supported) return null;

  const start = async () => {
    setError("");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await scanNfcUrls((url) => {
        const guid = checkpointGuidFromUrl(url);
        if (guid) {
          // vibrateScanAck() has its own internal try/catch, but this is the
          // one call standing between a matched tag and onScan() actually
          // opening the checkpoint — an unexpected throw here must never be
          // able to silently swallow the scan.
          try {
            vibrateScanAck();
          } catch (err) {
            console.warn("vibrateScanAck() threw (ignored):", err);
          }
          onScan(guid);
        }
      }, controller.signal);
      setActive(true);
    } catch (err) {
      controllerRef.current = null;
      setActive(false);
      setError(nfcErrorMessage(err));
    }
  };

  startRef.current = start;

  const stop = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setActive(false);
  };

  return (
    <button
      type="button"
      className={"btn btn-sm" + (active ? " btn-primary" : error ? " btn-danger" : "")}
      title={
        error ||
        (active
          ? "Scanning for checkpoint NFC tags — tap to stop"
          : "Tap to scan checkpoint NFC tags without leaving the app")
      }
      onClick={() => void (active ? stop() : start())}
    >
      {active ? "NFC ●" : "NFC"}
    </button>
  );
}
