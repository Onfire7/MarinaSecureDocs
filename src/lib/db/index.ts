import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema, type Database } from "./schema";

// The device's own database.
//
// Every read and every write in this app goes here, and only here. It is a
// real SQLite database in the browser, holding the subset of the marina's data
// this user is allowed to have (powersync/config/sync-config.yaml decides
// which). PowerSync keeps it current and drains local writes back to Postgres
// when there is signal. With no signal, nothing above this line behaves
// differently — which is the entire reason for the stack.
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    // One instance per file. Changing this name orphans the previous
    // database rather than migrating it, so it is effectively permanent.
    dbFilename: "marinasecure.db",
  },
});

// A handle on the device's own database, in development only.
//
// "The screen is empty" has at least four causes on this stack — the stream
// never delivered the row, the query is wrong, the permission gate excluded
// it, or the sync simply has not finished — and from outside the app they look
// identical. This makes the difference one question:
//
//   await __ps.get("SELECT COUNT(*) AS n FROM boats")
//
// import.meta.env.DEV is a compile-time constant, so this whole block is gone
// from a production bundle rather than merely unreachable in one.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __ps: typeof db }).__ps = db;
}

export { AppSchema };
export type { Database };

/**
 * A new row id.
 *
 * Ids are generated on the device, before the row has ever been near a server
 * — that is what makes an offline insert a real insert rather than a promise
 * of one. It is also what makes the upload connector's upsert safe: a replayed
 * queue writes the same id twice, not two rows.
 */
export function id(): string {
  return crypto.randomUUID();
}

// SQLite has no boolean and no date type, so PowerSync stores them as 0/1 and
// as text. These four functions are the whole conversion layer, and they are
// here rather than in each data module so there is one place to be wrong.

/** A SQLite 0/1 column as a boolean. */
export function bool(value: number | null | undefined): boolean {
  return value === 1;
}

/** A boolean as the 0/1 a SQLite column holds. */
export function flag(value: boolean | null | undefined): number {
  return value ? 1 : 0;
}

/**
 * A timestamp column as a Date, or null.
 *
 * Postgres `timestamptz` arrives as text in UTC. `new Date(text)` parses it
 * correctly; the wrapper exists so a null column does not become 1970.
 */
export function date(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

/** The text form a timestamptz column expects. */
export function stamp(value: Date | number = Date.now()): string {
  return new Date(value).toISOString();
}

/**
 * A Postgres array column, which PowerSync delivers JSON-encoded.
 *
 * roles.allow is `["view_owner","view_contact"]` — a string, not a string[].
 * Reading it without parsing yields a string that happens to contain the right
 * words, and `.includes()` on it very nearly works, which is worse than if it
 * did not.
 */
export function jsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** A jsonb column, which arrives as text, as its parsed value. */
export function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
