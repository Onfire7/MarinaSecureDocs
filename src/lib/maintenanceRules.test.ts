import { describe, expect, it } from "vitest";
import { dueMeterMaintenanceRules, maintenanceRuleTitle } from "./maintenanceRules";
import { aMeterReading, aTicket, anAsset } from "../test/fixtures";

const at = (iso: string) => new Date(iso).getTime();

describe("dueMeterMaintenanceRules", () => {
  it("fires once the reading has advanced a full interval past the baseline", () => {
    const asset = anAsset({ name: "Cart 3" });
    const rules = [{ kind: "meter" as const, every: 100, label: "oil change" }];
    const readings = [aMeterReading({ value: 500, timestamp: at("2026-01-01T00:00:00Z") })];
    expect(dueMeterMaintenanceRules(asset, rules, 600, readings, [])).toHaveLength(1);
  });

  it("does not fire one unit short of the interval", () => {
    const asset = anAsset();
    const rules = [{ kind: "meter" as const, every: 100 }];
    const readings = [aMeterReading({ value: 500, timestamp: at("2026-01-01T00:00:00Z") })];
    expect(dueMeterMaintenanceRules(asset, rules, 599, readings, [])).toEqual([]);
  });

  it("treats a missing reading history as a baseline of zero", () => {
    const asset = anAsset();
    const rules = [{ kind: "meter" as const, every: 100 }];
    expect(dueMeterMaintenanceRules(asset, rules, 150, [], [])).toHaveLength(1);
  });

  it("suppresses a rule while its ticket is still open", () => {
    // Otherwise every meter reading during an unfinished job raises another
    // identical ticket.
    const asset = anAsset({ name: "Cart 3" });
    const rules = [{ kind: "meter" as const, every: 100 }];
    const rule = { kind: "meter" as const, every: 100 };
    const open = aTicket({
      title: maintenanceRuleTitle(asset, rule),
      auto_generated: 1,
      resolved_at: null,
      created_at: at("2026-02-01T00:00:00Z"),
    });
    const readings = [aMeterReading({ value: 500, timestamp: at("2026-01-01T00:00:00Z") })];
    expect(dueMeterMaintenanceRules(asset, rules, 900, readings, [open])).toEqual([]);
  });

  it("rebaselines from the first reading at or after the last resolved ticket", () => {
    // The point of the whole function: after an oil change at 600, the next
    // one is due at 700 — not immediately, because the earliest-ever reading
    // is still 500.
    const asset = anAsset({ name: "Cart 3" });
    const rules = [{ kind: "meter" as const, every: 100 }];
    const rule = { kind: "meter" as const, every: 100 };
    const resolved = aTicket({
      title: maintenanceRuleTitle(asset, rule),
      auto_generated: 1,
      created_at: at("2026-02-01T00:00:00Z"),
      resolved_at: at("2026-02-02T00:00:00Z"),
    });
    const readings = [
      aMeterReading({ value: 500, timestamp: at("2026-01-01T00:00:00Z") }),
      aMeterReading({ value: 600, timestamp: at("2026-02-01T06:00:00Z") }),
    ];
    expect(dueMeterMaintenanceRules(asset, rules, 650, readings, [resolved])).toEqual([]);
    expect(dueMeterMaintenanceRules(asset, rules, 700, readings, [resolved])).toHaveLength(1);
  });

  it("ignores time-based rules, which nothing generates yet", () => {
    const asset = anAsset();
    const rules = [
      { kind: "time" as const, every: 90, label: "annual service" },
      { kind: "meter" as const, every: 100 },
    ];
    const due = dueMeterMaintenanceRules(asset, rules, 500, [], []);
    expect(due).toHaveLength(1);
    expect(due[0].kind).toBe("meter");
  });

  it("ignores hand-raised tickets that happen to share a title", () => {
    const asset = anAsset({ name: "Cart 3" });
    const rules = [{ kind: "meter" as const, every: 100 }];
    const rule = { kind: "meter" as const, every: 100 };
    const manual = aTicket({
      title: maintenanceRuleTitle(asset, rule),
      auto_generated: 0,
      resolved_at: null,
    });
    expect(dueMeterMaintenanceRules(asset, rules, 150, [], [manual])).toHaveLength(1);
  });
});
