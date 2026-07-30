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
