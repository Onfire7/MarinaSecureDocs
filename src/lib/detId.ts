// A deterministic, UUID-shaped id derived from a stable seed string.
// Used where a write needs to be safely re-run (e.g. resuming a checkpoint
// check-in re-evaluates which Checklists to generate) without risking a
// duplicate: transact .update() is an upsert, so reusing the same id for the
// same seed makes the operation idempotent instead of creating a second row.
export function deterministicId(seed: string): string {
  // FNV-1a over the seed, expanded to 128 bits by re-hashing with a salt.
  const h1 = fnv1a(seed);
  const h2 = fnv1a(`${seed}:2`);
  const hex = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).padEnd(
    32,
    "0",
  );
  const bytes = hex.slice(0, 32);
  return [
    bytes.slice(0, 8),
    bytes.slice(8, 12),
    "4" + bytes.slice(13, 16), // version 4
    ((parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16) + bytes.slice(17, 20), // variant
    bytes.slice(20, 32),
  ].join("-");
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
