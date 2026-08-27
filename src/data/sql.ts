import type { LockContext } from "@powersync/web";
import { db, id as newId } from "../lib/db";

// Statement builders for the shapes that repeat, so ~230 call sites do not
// each hand-write a column list and a matching run of `?`.
//
// Values are ALWAYS parameters. Table and column names are interpolated, and
// they may only ever be literals written in this repo — never a value from a
// row, a URL, or a form. Nothing here checks that, because nothing here could:
// it is a rule about call sites, and it is why every caller in src/data/ names
// its columns inline rather than passing a variable through.

export type Row = Record<string, unknown>;

/** The database, or an open write transaction. */
export type Executor = Pick<LockContext, "execute" | "getAll" | "getOptional">;

function prepare(row: Row): { keys: string[]; values: unknown[] } {
  const keys: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(row)) {
    // `undefined` means "not mentioned"; null means "set to null". Passing
    // undefined through to SQLite binds null, which would quietly clear a
    // column the caller never intended to touch.
    if (value === undefined) continue;
    keys.push(key);
    values.push(value instanceof Date ? value.toISOString() : value);
  }
  return { keys, values };
}

/**
 * Insert a row, generating its id if the caller did not.
 *
 * Returns the id, because almost every caller needs it — to link the next row,
 * to navigate to the thing just created, or to write the activity entry that
 * refers to it.
 */
export async function insert(
  executor: Executor,
  table: string,
  row: Row,
): Promise<string> {
  const rowId = (row.id as string | undefined) ?? newId();
  const { keys, values } = prepare({ ...row, id: rowId });
  await executor.execute(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    values,
  );
  return rowId;
}

/** Update one row by id. A row with only undefined values is a no-op. */
export async function update(
  executor: Executor,
  table: string,
  rowId: string,
  row: Row,
): Promise<void> {
  const { keys, values } = prepare(row);
  if (keys.length === 0) return;
  await executor.execute(
    `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...values, rowId],
  );
}

/**
 * Insert a row only if its id is not already present.
 *
 * The idempotent half of deterministic ids: a re-scanned checkpoint or a
 * replayed write queue derives the same id and must not write a second row —
 * or, worse, overwrite the first and lose whatever was recorded against it.
 *
 * Not `INSERT OR REPLACE`: PowerSync's local tables are views with INSTEAD OF
 * triggers, and a replace becomes a DELETE followed by an INSERT — which would
 * put a spurious delete in the upload queue for a row that never went away.
 */
export async function insertIfAbsent(
  executor: Executor,
  table: string,
  rowId: string,
  row: Row,
): Promise<boolean> {
  const existing = await executor.getOptional<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ?`,
    [rowId],
  );
  if (existing) return false;
  await insert(executor, table, { ...row, id: rowId });
  return true;
}

/** Delete one row by id. */
export async function remove(
  executor: Executor,
  table: string,
  rowId: string,
): Promise<void> {
  await executor.execute(`DELETE FROM ${table} WHERE id = ?`, [rowId]);
}

/**
 * Run several writes as one transaction.
 *
 * Local atomicity is the smaller half of what this buys. PowerSync uploads a
 * transaction's operations together, so a ticket and the activity entry
 * describing it reach Postgres in the same request — rather than as two, with
 * a dead zone in between.
 */
export function transact<T>(fn: (tx: LockContext) => Promise<T>): Promise<T> {
  return db.writeTransaction(fn);
}
