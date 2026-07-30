// Web NFC tag writing — Chrome on Android only, over HTTPS, from a user
// gesture. There's no capability to feature-test other than the constructor's
// presence; everything else only fails once a write is actually attempted.

export function nfcWriteSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

/** Writes `url` as an NDEF URL record. Resolves once the tag is written. */
export async function writeNfcUrl(url: string, signal: AbortSignal): Promise<void> {
  if (!window.NDEFReader) {
    throw new DOMException("Web NFC isn't available in this browser.", "NotSupportedError");
  }
  const reader = new window.NDEFReader();
  await reader.write({ records: [{ recordType: "url", data: url }] }, { signal });
}

/** A short, guard-facing explanation for a failed write. */
export function nfcErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotSupportedError":
      return "This device doesn't support NFC, or NFC is turned off.";
    case "NotAllowedError":
      return "NFC permission was denied. Allow NFC access for this site and try again.";
    case "NetworkError":
      return "The tag was removed too soon, or couldn't be written. Hold it steady and try again.";
    default:
      return "Couldn't write the tag. Try again.";
  }
}
