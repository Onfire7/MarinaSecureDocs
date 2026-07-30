// Web NFC — Chrome on Android only, over HTTPS, from a user gesture. There's
// no capability to feature-test beyond the constructor's presence; both
// reading and writing only fail once actually attempted.

// TEMPORARY: a non-blocking on-screen log (no computer to remote-debug with,
// and a blocking alert() here previously broke the scan pipeline outright —
// this only ever appends DOM nodes, never intercepts or pauses anything).
// Remove this and its call sites once scanning is confirmed working.
let debugPanel: HTMLDivElement | null = null;
export function nfcDebugLog(message: string): void {
  if (typeof document === "undefined") return;
  if (!debugPanel) {
    debugPanel = document.createElement("div");
    debugPanel.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:999999;background:#111;color:#0f0;" +
      "font:11px/1.4 monospace;padding:8px;white-space:pre-wrap;word-break:break-all;" +
      "max-height:55vh;overflow-y:auto;pointer-events:none;";
    document.body.appendChild(debugPanel);
  }
  const line = document.createElement("div");
  const t = new Date();
  const stamp = `${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}.${t.getMilliseconds().toString().padStart(3, "0")}`;
  line.textContent = `[${stamp}] ${message}`;
  debugPanel.appendChild(line);
  // Keep it from growing forever across a long test session.
  while (debugPanel.childNodes.length > 40) debugPanel.removeChild(debugPanel.firstChild!);
}

function nfcSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

export const nfcWriteSupported = nfcSupported;
export const nfcReadSupported = nfcSupported;

/** Writes `url` as an NDEF URL record. Resolves once the tag is written. */
export async function writeNfcUrl(url: string, signal: AbortSignal): Promise<void> {
  if (!window.NDEFReader) {
    throw new DOMException("Web NFC isn't available in this browser.", "NotSupportedError");
  }
  const reader = new window.NDEFReader();
  await reader.write({ records: [{ recordType: "url", data: url }] }, { signal });
}

function urlFromMessage(message: NDEFMessage): string | null {
  for (const record of message.records) {
    if ((record.recordType === "url" || record.recordType === "absolute-url") && record.data) {
      return new TextDecoder(record.encoding ?? "utf-8").decode(record.data);
    }
  }
  return null;
}

/**
 * Starts a scan session and calls `onUrl` for every subsequent tag read that
 * carries a URL record — one call keeps listening for repeated taps until
 * `signal` aborts, rather than needing to be restarted per tag. Resolves
 * once scanning has actually started (not once it stops).
 */
export async function scanNfcUrls(
  onUrl: (url: string) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!window.NDEFReader) {
    nfcDebugLog("scanNfcUrls: window.NDEFReader missing");
    throw new DOMException("Web NFC isn't available in this browser.", "NotSupportedError");
  }
  const reader = new window.NDEFReader();
  reader.onreading = (event) => {
    nfcDebugLog(
      `onreading fired — serialNumber=${event.serialNumber || "(none)"}, ` +
        `records=${event.message.records.map((r) => r.recordType).join(",") || "(none)"}`,
    );
    const url = urlFromMessage(event.message);
    nfcDebugLog(`extracted url: ${url ?? "(no url/absolute-url record with data)"}`);
    if (url) onUrl(url);
  };
  // Never wired up before now — if a tag's NDEF data doesn't parse cleanly,
  // Chrome fires this instead of onreading, and until now that failure was
  // completely invisible: no event, no console output, nothing.
  reader.onreadingerror = () => {
    nfcDebugLog("onreadingerror fired — tag was detected but couldn't be read");
  };
  nfcDebugLog("calling reader.scan()…");
  await reader.scan({ signal });
  nfcDebugLog("reader.scan() resolved — now listening for taps");
}

/**
 * If `url` is this app's checkpoint check-in link, returns the checkpoint's
 * guidUrl; otherwise null (a tag encoding something else, scanned
 * incidentally, is silently ignored rather than acted on).
 */
export function checkpointGuidFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return null;
  }
  if (parsed.origin !== window.location.origin) return null;
  const match = parsed.pathname.match(/^\/checkin\/([^/]+)$/);
  return match ? match[1] : null;
}

function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return false;
  return navigator.vibrate(pattern);
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  audioCtx ??= new window.AudioContext();
  return audioCtx;
}

function beep(ctx: AudioContext, atTime: number, freqHz: number): void {
  const durationSec = 0.09;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freqHz;
  // Ramped rather than a hard on/off edge, which clicks audibly at this
  // short a duration.
  gain.gain.setValueAtTime(0.0001, atTime);
  gain.gain.exponentialRampToValueAtTime(0.2, atTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + durationSec + 0.02);
}

/** `beepCount` short tones in a row — the audible fallback for `vibrate()`. */
function chime(beepCount: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const start = ctx.currentTime;
  for (let i = 0; i < beepCount; i++) {
    beep(ctx, start + i * 0.14, 880);
  }
}

// Wrapped in try/catch so a thrown exception here (vibrate/AudioContext
// misbehaving on some device) can never abort the caller mid-callback —
// onScan()/setStatus("success") must still run regardless of whether the
// ack itself worked. Deliberately no alert()/blocking dialog: one sat here
// briefly for on-device debugging and turned out to itself break the scan
// pipeline (a synchronous dialog colliding with the NFC reading callback,
// and/or Chrome auto-suppressing repeated dialogs after a few taps) —
// console.warn only from here on.
function ack(pattern: number | number[], beepCount: number): void {
  try {
    const vibrated = vibrate(pattern);
    nfcDebugLog(`ack: navigator.vibrate(${JSON.stringify(pattern)}) returned ${vibrated}`);
    // Not gated on vibrate's reported success — a `true` return only means
    // the browser accepted the call, not that the phone actually physically
    // vibrated. Android's vibration/haptics setting can suppress the motor
    // independently of ringer/silent mode, with no way for the page to tell
    // the difference, so the one channel we can actually confirm worked
    // shouldn't be skipped on the other's word for it.
    chime(beepCount);
    if (!vibrated) {
      console.warn("navigator.vibrate() was rejected or unsupported; chimed instead.");
    }
  } catch (err) {
    console.warn("NFC ack failed:", err);
  }
}

/** Haptic ack and a short chime that a checkpoint tag was recognized while
 *  scanning — both attempted regardless of whether the other reports success,
 *  since vibrate() can claim success without the phone actually vibrating. */
export function vibrateScanAck(): void {
  ack(200, 1);
}

/** Two vibration pulses and two tones acknowledging a tag was successfully
 *  written — same both-channels reasoning as vibrateScanAck. */
export function vibrateWriteAck(): void {
  ack([150, 100, 150], 2);
}

/** A short, guard-facing explanation for a failed read or write. */
export function nfcErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotSupportedError":
      return "This device doesn't support NFC, or NFC is turned off.";
    case "NotAllowedError":
      return "NFC permission was denied. Allow NFC access for this site and try again.";
    case "NetworkError":
      return "The tag was removed too soon, or couldn't be read/written. Hold it steady and try again.";
    default:
      return "Couldn't reach the tag. Try again.";
  }
}
