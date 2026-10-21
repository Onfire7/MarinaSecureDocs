import { describe, expect, it } from "vitest";

// Test 1 of the approved list for Ticket Updates and Incident Updates
// (ADR 0008). The history is written by the app in the same transaction as
// the change, not by a database trigger, so the guarantee that nothing
// bypasses it has to live here: every write to a ticket or incident goes
// through its owning data module, which is what writes the Update beside it.
//
// Same approach as noBareToLocale.test.ts: every source file's text, through
// Vite, because the app's tsconfig deliberately has no Node types.
const SOURCES = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const OWNED: Record<string, string> = {
  tickets: "src/data/tickets.ts",
  ticket_updates: "src/data/tickets.ts",
  incidents: "src/data/incidents.ts",
  incident_comments: "src/data/incidents.ts",
  incident_updates: "src/data/incidents.ts",
};

/** A data-layer write to one of the owned tables: insert(x, "t", …), update(x, "t", …), or raw SQL. */
function writesTo(table: string): RegExp {
  return new RegExp(
    `\\b(?:insert|update|insertIfAbsent)\\(\\s*[^,]+,\\s*["'\`]${table}["'\`]|\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`,
    "i",
  );
}

describe("tickets and incidents are written only by their owning data module", () => {
  it("the pattern catches the forms that matter, and not reads", () => {
    const w = writesTo("tickets");
    expect(w.test('insert(tx, "tickets", {')).toBe(true);
    expect(w.test('update(db, "tickets", id, {')).toBe(true);
    expect(w.test("INSERT INTO tickets (title)")).toBe(true);
    expect(w.test("UPDATE tickets SET")).toBe(true);
    expect(w.test("SELECT title FROM tickets WHERE")).toBe(false);
    expect(w.test('insert(tx, "ticket_updates", {')).toBe(false);
  });

  it("no file other than the owner writes to the table", () => {
    const offenders: string[] = [];
    for (const [table, owner] of Object.entries(OWNED)) {
      const re = writesTo(table);
      for (const [path, text] of Object.entries(SOURCES)) {
        const file = path.slice(1);
        if (file === owner) continue;
        if (re.test(text)) offenders.push(`${file} writes ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
