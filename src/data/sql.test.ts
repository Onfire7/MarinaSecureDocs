import { describe, expect, it } from "vitest";
import { insert, insertIfAbsent, remove, update } from "./sql";

/**
 * Every write in the app goes through these four functions, so a defect here
 * is a defect everywhere at once. Two of the behaviours below are the ones
 * that would be silent:
 *
 *   * `undefined` means "not mentioned" and `null` means "set to null". Binding
 *     undefined through to SQLite writes NULL, which would clear a column the
 *     caller never named — the shape of bug this codebase keeps meeting.
 *   * Values are always parameters. A caller who managed to get a value into
 *     the statement text would have written an injection.
 */

/** Records what it was asked to run, and answers reads from a fixed set. */
function recorder(rows: Record<string, unknown>[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    execute: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return {} as never;
    },
    getAll: async () => rows as never,
    getOptional: async () => (rows[0] ?? null) as never,
  };
}

describe("insert", () => {
  it("binds every value as a parameter, never into the statement", async () => {
    const db = recorder();
    await insert(db, "tickets", { title: "'; DROP TABLE tickets; --", priority: "low" });
    const [call] = db.calls;
    expect(call.sql).not.toContain("DROP TABLE");
    expect(call.params).toContain("'; DROP TABLE tickets; --");
  });

  it("generates an id when the caller gives none, and returns it", async () => {
    const db = recorder();
    const id = await insert(db, "tickets", { title: "x" });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.calls[0].params).toContain(id);
  });

  it("keeps a caller-supplied id — deterministic ids depend on it", async () => {
    const db = recorder();
    const id = await insert(db, "checklist_instances", { id: "fixed-id", status: "x" });
    expect(id).toBe("fixed-id");
  });

  it("serialises a Date to ISO text, because SQLite has no date type", async () => {
    const db = recorder();
    await insert(db, "shifts", { started_at: new Date("2026-08-27T04:00:00Z") });
    expect(db.calls[0].params).toContain("2026-08-27T04:00:00.000Z");
  });

  it("omits undefined columns and keeps explicit nulls", async () => {
    const db = recorder();
    await insert(db, "tickets", { title: "x", description: undefined, asset_id: null });
    expect(db.calls[0].sql).not.toContain("description");
    expect(db.calls[0].sql).toContain("asset_id");
  });
});

describe("update", () => {
  it("does nothing at all when every value is undefined", async () => {
    // The bulk-edit bar builds patches this way; an empty one must not become
    // `UPDATE ... SET  WHERE id = ?`, and must not touch the row either.
    const db = recorder();
    await update(db, "locations", "l1", { name: undefined, status_id: undefined });
    expect(db.calls).toHaveLength(0);
  });

  it("clears a column asked to be null while leaving unmentioned ones alone", async () => {
    const db = recorder();
    await update(db, "tickets", "t1", { resolved_at: null, title: undefined });
    expect(db.calls[0].sql).toContain("resolved_at = ?");
    expect(db.calls[0].sql).not.toContain("title");
    expect(db.calls[0].params).toEqual([null, "t1"]);
  });

  it("puts the id last, matching the trailing placeholder", async () => {
    const db = recorder();
    await update(db, "tickets", "t1", { title: "a", priority: "low" });
    expect(db.calls[0].params).toEqual(["a", "low", "t1"]);
  });
});

describe("insertIfAbsent", () => {
  it("writes when the id is absent", async () => {
    const db = recorder([]);
    const written = await insertIfAbsent(db, "check_ins", "c1", { method: "scanned" });
    expect(written).toBe(true);
    expect(db.calls).toHaveLength(1);
  });

  it("writes nothing when the id is already there", async () => {
    // The idempotent half of deterministic ids: a re-scanned checkpoint or a
    // replayed upload queue must not overwrite the row it already produced,
    // taking whatever was recorded against it with it.
    const db = recorder([{ id: "c1" }]);
    const written = await insertIfAbsent(db, "check_ins", "c1", { method: "scanned" });
    expect(written).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});

describe("remove", () => {
  it("deletes exactly one row, by parameter", async () => {
    const db = recorder();
    await remove(db, "tickets", "t1");
    expect(db.calls[0].sql).toBe("DELETE FROM tickets WHERE id = ?");
    expect(db.calls[0].params).toEqual(["t1"]);
  });
});
