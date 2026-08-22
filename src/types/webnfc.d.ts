// Minimal ambient types for the Web NFC API (https://w3c.github.io/web-nfc/).
// Not in TypeScript's DOM lib — support is Chrome-on-Android only, behind a
// user gesture and a secure context. Declares only what src/lib/nfc.ts uses.

interface NDEFRecordInit {
  recordType: string;
  mediaType?: string;
  id?: string;
  data?: string | BufferSource;
}

interface NDEFMessageInit {
  records: NDEFRecordInit[];
}

interface NDEFWriteOptions {
  overwrite?: boolean;
  signal?: AbortSignal;
}

interface NDEFScanOptions {
  signal?: AbortSignal;
}

interface NDEFRecord {
  recordType: string;
  mediaType?: string;
  id?: string;
  data?: DataView;
  encoding?: string;
  lang?: string;
}

interface NDEFMessage {
  records: NDEFRecord[];
}

interface NDEFReadingEvent extends Event {
  serialNumber: string;
  message: NDEFMessage;
}

declare class NDEFReader extends EventTarget {
  write(message: string | NDEFMessageInit, options?: NDEFWriteOptions): Promise<void>;
  scan(options?: NDEFScanOptions): Promise<void>;
  onreading: ((this: NDEFReader, ev: NDEFReadingEvent) => void) | null;
  onreadingerror: ((this: NDEFReader, ev: Event) => void) | null;
}

interface Window {
  NDEFReader?: typeof NDEFReader;
}
