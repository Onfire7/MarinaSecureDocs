// Web NFC — Chrome on Android only, over HTTPS, from a user gesture. There's
// no capability to feature-test beyond the constructor's presence; both
// reading and writing only fail once actually attempted.

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
    throw new DOMException("Web NFC isn't available in this browser.", "NotSupportedError");
  }
  const reader = new window.NDEFReader();
  reader.onreading = (event) => {
    const url = urlFromMessage(event.message);
    if (url) onUrl(url);
  };
  await reader.scan({ signal });
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

// The Vibration API has no permission prompt (unlike camera/mic/geolocation)
// — Chrome just silently no-ops navigator.vibrate() and returns false if the
// frame has never seen a genuine user gesture (sticky activation, so a click
// anywhere on the page satisfies it permanently — it isn't a narrow "must be
// within this same event handler" window). Both call sites here are already
// downstream of a real click (the NFC toggle, the Write tag button), so that
// should be satisfied; logging the false case anyway distinguishes "browser
// rejected it" from "device haptics are just off," which otherwise look
// identical from here. Either way, a rejected/unsupported vibration falls
// back to a synthesized chime — no permission prompt for that either, and it
// gets through in cases (haptics disabled, iOS, desktop) vibration can't.
function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return false;
  const accepted = navigator.vibrate(pattern);
  if (!accepted) {
    console.warn(
      "navigator.vibrate() was rejected — no user gesture registered on this page yet.",
    );
  }
  return accepted;
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

/** Brief haptic ack (or chime, if vibration isn't available) that a
 *  checkpoint tag was recognized while scanning. */
export function vibrateScanAck(): void {
  if (!vibrate(200)) chime(1);
}

/** Two short pulses (or two tones) acknowledging a tag was successfully
 *  written. */
export function vibrateWriteAck(): void {
  if (!vibrate([150, 100, 150])) chime(2);
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
