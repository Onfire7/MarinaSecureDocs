// Web NFC — Chrome on Android only, over HTTPS, from a user gesture. There's
// no capability to feature-test beyond the constructor's presence; both
// reading and writing only fail once actually attempted.

function nfcSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

/**
 * Whether a scan can start WITHOUT a tap.
 *
 * Chrome wants a user gesture only to show the permission prompt. Once a guard
 * has allowed NFC on this origin, scan() may be called on open — which is what
 * makes a tag tapped a second after unlocking the phone land in the app rather
 * than in a new browser tab. Anything short of "granted" is false: prompting
 * unasked is not possible, and would not be welcome.
 */
export async function nfcPermissionGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({
      name: "nfc" as PermissionName,
    });
    return status.state === "granted";
  } catch {
    return false;
  }
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
  // A tag whose NDEF data doesn't parse cleanly fires this instead of
  // onreading — logged rather than silently dropped, though there's nothing
  // actionable to do about a single bad read beyond trying again.
  reader.onreadingerror = () => {
    console.warn("NFC tag detected but couldn't be read (onreadingerror).");
  };
  await reader.scan({ signal });
}

/**
 * If `url` is a checkpoint check-in link, returns the checkpoint's guidUrl;
 * otherwise null (a tag encoding something else, scanned incidentally, is
 * silently ignored rather than acted on).
 *
 * The origin is deliberately NOT compared. It used to be, and the effect was
 * that every tag in the marina — all written by the deployment at another
 * hostname — went dead the day the app moved. The origin protects nothing:
 * the guid is looked up in this marina's own database, so a tag from anywhere
 * else resolves to "unknown tag" and no further. A marina's tags outlive the
 * hostname that wrote them, and must.
 */
export function checkpointGuidFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return null;
  }
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
// ack itself worked.
function ack(pattern: number | number[], beepCount: number): void {
  try {
    const vibrated = vibrate(pattern);
    // Not gated on vibrate's reported success — a `true` return only means
    // the browser accepted the call, not that the phone actually physically
    // vibrated. Confirmed on a Pixel 10 (Android 17): navigator.vibrate()
    // returned true with no felt vibration at all, in both Chrome and
    // Vivaldi, because Settings > Sound & vibration > Vibration & haptics >
    // Interactive haptics > Touch Feedback was off — a system setting
    // independent of ringer/silent mode, with no way for the page to
    // detect it. So the one channel we can actually confirm worked
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
