/**
 * Parse a JSON column from the device's SQLite, where jsonb arrives as text.
 *
 * Tolerates one layer of double-encoding. For eleven days every write to a
 * jsonb column was uploaded as text, which Postgres stored as a JSON *string*
 * and synced back wrapped in quotes — so a checklist answer parsed to a string
 * and `.value` on it was undefined, which is how "Recorded undefined" got onto
 * the mileage card. The upload is fixed (uploadShape.ts) and the rows were
 * repaired, but a device may still hold one, and reading it correctly costs
 * one typeof.
 */
export function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string" && /^[[{]/.test(parsed.trim())) {
      try {
        return JSON.parse(parsed) as T;
      } catch {
        // A string that merely starts with a brace. It is what it is.
      }
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}
