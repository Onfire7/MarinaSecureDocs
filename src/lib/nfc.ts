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

// TEMPORARY: neither vibration nor the chime were confirmed felt/heard on a
// real device, and there's no computer on hand for remote debugging. Each ack
// below pops a single alert() reporting exactly what it tried and what the
// browser told it, wrapped so a thrown exception shows up as an alert too
// instead of silently aborting mid-function (which, before this, could have
// left onScan()/setStatus("success") never reached). Remove once we know why.
const DEBUG_ALERT = true;

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
function chime(beepCount: number): string {
  const ctx = getAudioContext();
  if (!ctx) return "AudioContext unavailable (no window.AudioContext)";
  const resumeNeeded = ctx.state === "suspended";
  if (resumeNeeded) void ctx.resume();
  const start = ctx.currentTime;
  for (let i = 0; i < beepCount; i++) {
    beep(ctx, start + i * 0.14, 880);
  }
  return `AudioContext state=${ctx.state}${resumeNeeded ? " (resume() called)" : ""}, ${beepCount} beep(s) scheduled`;
}

function ack(pattern: number | number[], beepCount: number, label: string): void {
  const lines: string[] = [];
  try {
    const hasVibrate = typeof navigator !== "undefined" && "vibrate" in navigator;
    lines.push(`vibrate supported: ${hasVibrate}`);
    let vibrated = false;
    if (hasVibrate) {
      vibrated = vibrate(pattern);
      lines.push(`navigator.vibrate(${JSON.stringify(pattern)}) returned: ${vibrated}`);
    }
    if (!vibrated) {
      lines.push(chime(beepCount));
    }
  } catch (err) {
    lines.push(`THREW: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
  if (DEBUG_ALERT) {
    alert(`NFC ${label} ack debug —\n` + lines.join("\n"));
  }
}

/** Brief haptic ack (or chime, if vibration isn't available) that a
 *  checkpoint tag was recognized while scanning. */
export function vibrateScanAck(): void {
  ack(200, 1, "scan");
}

/** Two short pulses (or two tones) acknowledging a tag was successfully
 *  written. */
export function vibrateWriteAck(): void {
  ack([150, 100, 150], 2, "write");
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
