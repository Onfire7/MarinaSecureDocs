import { describe, expect, it } from "vitest";
import {
  TARGET_TYPES,
  attachmentColumns,
  attachmentJoins,
  attachmentOf,
  attachmentSelect,
  targetColumn,
  targetPath,
} from "./attachments";

/**
 * The attachable-entities pattern: every note, incident and ticket attaches to
 * exactly one of six targets.
 *
 * That invariant used to be enforced by application code alone, and one of
 * seven real tickets violated it. It is now a database CHECK —
 * `num_nonnulls(...) = 1` — so the unattached case below is unreachable in
 * Postgres. It stays tested because it is still reachable *locally*: a row
 * whose six target rows are all outside this device's sync window reads
 * exactly like one with no target, and the reader must not crash on it.
 */
describe("attachmentOf", () => {
  it("returns the single set target", () => {
    expect(
      attachmentOf({
        target_type: "location",
        target_id: "l1",
        target_label: "Slip 14",
      }),
    ).toEqual({ type: "location", id: "l1", label: "Slip 14" });
  });

  it("falls back to a placeholder label for a nameless contact", () => {
    expect(
      attachmentOf({ target_type: "contact", target_id: "c1", target_label: null })
        ?.label,
    ).toBe("Unnamed contact");
  });

  it("names the kind when the target row is not on this device", () => {
    // Occupancy scoping: a boat can fall out of the window while the ticket
    // about it stays open. Losing the label is acceptable; losing the ticket
    // is not, which is why the joins are LEFT joins.
    expect(
      attachmentOf({ target_type: "boat", target_id: "b1", target_label: null }),
    ).toEqual({ type: "boat", id: "b1", label: "Boat" });
  });

  it("returns null when nothing is attached", () => {
    expect(
      attachmentOf({ target_type: null, target_id: null, target_label: null }),
    ).toBeNull();
  });
});

describe("targetPath", () => {
  it("routes every one of the six target types", () => {
    for (const { key } of TARGET_TYPES) {
      const path = targetPath({ type: key, id: "x1", label: "X" });
      expect(path.startsWith("/")).toBe(true);
      expect(path).toContain("x1");
    }
  });
});

describe("attachmentColumns", () => {
  it("sets exactly one column and nulls the other five", () => {
    const columns = attachmentColumns({ type: "asset", id: "a1", label: "Cart 3" });
    expect(columns.asset_id).toBe("a1");
    expect(Object.values(columns).filter((v) => v !== null)).toHaveLength(1);
  });

  it("nulls all six for no target, so an update can clear one", () => {
    expect(Object.values(attachmentColumns(null)).every((v) => v === null)).toBe(true);
  });

  it("names a column for every target type", () => {
    for (const { key, column } of TARGET_TYPES) {
      expect(targetColumn(key)).toBe(column);
      expect(attachmentColumns({ type: key, id: "x1", label: "X" })[column]).toBe("x1");
    }
  });
});

describe("attachmentSelect / attachmentJoins", () => {
  /**
   * These two build SQL that is only correct *together*: the SELECT reads
   * aliases the JOINs define. Separately each is valid SQL, so a mismatched
   * pair fails at query time rather than at compile time — which is the one
   * way to misuse them, and the reason for this test.
   */
  it("reads only aliases its own joins define", () => {
    const select = attachmentSelect("t");
    const joins = attachmentJoins("t");
    const aliases = [...joins.matchAll(/\bt_[a-z]+\b/g)].map((m) => m[0]);
    for (const alias of new Set([...select.matchAll(/\bt_[a-z]+\b/g)].map((m) => m[0]))) {
      expect(aliases).toContain(alias);
    }
  });

  it("namespaces its aliases by the row alias, so two can be joined at once", () => {
    // A query listing tickets AND their source incidents needs both sets of
    // target joins in one statement; identical alias names would collide.
    const ticket = attachmentJoins("t");
    const incident = attachmentJoins("i");
    const ticketAliases = new Set([...ticket.matchAll(/\bt_[a-z]+\b/g)].map((m) => m[0]));
    const incidentAliases = new Set([...incident.matchAll(/\bi_[a-z]+\b/g)].map((m) => m[0]));
    expect(ticketAliases.size).toBe(6);
    expect(incidentAliases.size).toBe(6);
    for (const alias of incidentAliases) expect(ticketAliases.has(alias)).toBe(false);
  });
});
