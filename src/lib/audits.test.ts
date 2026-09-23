import { describe, expect, it } from "vitest";
import {
  attributeDiff,
  gpsPrompt,
  mergeSearchMatch,
  orderTargets,
  rankNoteSuggestions,
  retireOrDelete,
  servicePresenceDiff,
  unexpectedOccupancy,
} from "./audits";

describe("unexpected occupancy", () => {
  it("occupied with nothing on file", () => {
    expect(unexpectedOccupancy({ occupied: true, hasCurrentLease: false, hasActiveReservation: false })).toBe(true);
  });
  it("vacant with a lease", () => {
    expect(unexpectedOccupancy({ occupied: false, hasCurrentLease: true, hasActiveReservation: false })).toBe(true);
  });
  it("occupied with a checked-in reservation is expected", () => {
    expect(unexpectedOccupancy({ occupied: true, hasCurrentLease: false, hasActiveReservation: true })).toBe(false);
  });
  it("a merely requested reservation does not count", () => {
    // The caller maps reservation status to hasActiveReservation; only
    // checked_in is active. A requested one leaves the slip unexpected.
    expect(unexpectedOccupancy({ occupied: true, hasCurrentLease: false, hasActiveReservation: false })).toBe(true);
    expect(unexpectedOccupancy({ occupied: false, hasCurrentLease: false, hasActiveReservation: false })).toBe(false);
  });
});

describe("gps prompt decision", () => {
  const settings = { radius: 15, accuracyLimit: 10 };
  const device = { lat: 33.0, lng: -96.0, accuracy: 6 };

  it("no coordinates prompts", () => {
    const d = gpsPrompt({ location: null, device, ...settings });
    expect(d.prompt).toBe(true);
    expect(d.captureEnabled).toBe(true);
    expect(d.reason).toBe("missing");
  });
  it("within radius doesn't prompt", () => {
    const d = gpsPrompt({ location: { lat: 33.00005, lng: -96.0 }, device, ...settings }); // ~5.5 m
    expect(d.prompt).toBe(false);
  });
  it("beyond radius prompts", () => {
    const d = gpsPrompt({ location: { lat: 33.001, lng: -96.0 }, device, ...settings }); // ~111 m
    expect(d.prompt).toBe(true);
    expect(d.reason).toBe("far");
    expect(d.distanceMeters).toBeGreaterThan(100);
  });
  it("accuracy worse than the setting disables capture", () => {
    const d = gpsPrompt({ location: null, device: { ...device, accuracy: 23 }, ...settings });
    expect(d.prompt).toBe(true);
    expect(d.captureEnabled).toBe(false);
    expect(d.accuracyMeters).toBe(23);
  });
  it("no device fix at all prompts but cannot capture", () => {
    const d = gpsPrompt({ location: null, device: null, ...settings });
    expect(d.prompt).toBe(true);
    expect(d.captureEnabled).toBe(false);
  });
});

describe("note suggestions", () => {
  it("rank by use count then name", () => {
    expect(rankNoteSuggestions(["shared pedestal", "metered", "Metered", "metered", "b-side", "a-side"])).toEqual([
      "metered",
      "a-side",
      "b-side",
      "shared pedestal",
    ]);
  });
  it("ignores blanks", () => {
    expect(rankNoteSuggestions(["", "  ", "x"])).toEqual(["x"]);
  });
});

describe("retire or delete", () => {
  const none = { tickets: 0, notes: 0, incidents: 0, leases: 0, reservations: 0, checkpoints: 0, children: 0, occupants: 0, findings: 0 };
  it("any nonzero count retires", () => {
    expect(retireOrDelete({ ...none, tickets: 1 })).toBe("retire");
    expect(retireOrDelete({ ...none, findings: 1 })).toBe("retire");
    expect(retireOrDelete({ ...none, children: 2 })).toBe("retire");
  });
  it("all zero deletes", () => {
    expect(retireOrDelete(none)).toBe("delete");
  });
});

describe("distance then tree ordering", () => {
  const device = { lat: 33.0, lng: -96.0 };
  const t = (id: string, treeIndex: number, lat: number | null, lng: number | null) => ({ id, treeIndex, lat, lng });
  it("located targets first by distance, unlocated after in tree order", () => {
    const out = orderTargets(
      [t("far", 0, 33.002, -96.0), t("nogps1", 1, null, null), t("near", 2, 33.0001, -96.0), t("nogps0", 3, null, null)],
      device,
    );
    expect(out.map((x) => x.id)).toEqual(["near", "far", "nogps1", "nogps0"]);
  });
  it("with no device fix, everything is in tree order", () => {
    const out = orderTargets([t("b", 1, 33.0, -96.0), t("a", 0, null, null)], null);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("search merge never erases typed fields", () => {
  it("a matched boat plus typed name and registration yields updates only for the record's empty or differing fields", () => {
    const typed = { name: "Sea Breeze", registration: "TX 1234 AB" };
    const matched = { id: "b1", name: "Sea Breeze", registration: null };
    const m = mergeSearchMatch(typed, matched);
    expect(m.recordId).toBe("b1");
    expect(m.fields).toEqual({ name: "Sea Breeze", registration: "TX 1234 AB" });
    expect(m.updates).toEqual([{ field: "registration", from: null, to: "TX 1234 AB" }]);
  });
  it("a differing typed value is offered, not applied silently, and the record's value is kept as the field", () => {
    const m = mergeSearchMatch({ name: "Sea Breeze II", registration: "TX 1234 AB" }, { id: "b1", name: "Sea Breeze", registration: "TX 1234 AB" });
    expect(m.fields).toEqual({ name: "Sea Breeze", registration: "TX 1234 AB" });
    expect(m.updates).toEqual([{ field: "name", from: "Sea Breeze", to: "Sea Breeze II" }]);
  });
  it("an empty typed field never produces an update", () => {
    const m = mergeSearchMatch({ name: "", registration: "TX 1" }, { id: "b1", name: "Sea Breeze", registration: "TX 1" });
    expect(m.updates).toEqual([]);
    expect(m.fields.name).toBe("Sea Breeze");
  });
});

describe("service presence diff yields proposals", () => {
  const current = [
    { serviceId: "power30", working: true, note: null },
    { serviceId: "water", working: true, note: "shared" },
  ];
  it("presence changes become proposals; working and note changes apply at once", () => {
    const observed = [
      { serviceId: "power30", present: true, working: false, note: "metered" },
      { serviceId: "water", present: false, working: true, note: "shared" },
      { serviceId: "sewer", present: true, working: true, note: null },
    ];
    const d = servicePresenceDiff(current, observed);
    expect(d.proposals).toEqual([
      { serviceId: "water", present: false },
      { serviceId: "sewer", present: true },
    ]);
    expect(d.immediate).toEqual([{ serviceId: "power30", working: false, note: "metered" }]);
  });
  it("an unchanged observation produces nothing", () => {
    const d = servicePresenceDiff(current, [
      { serviceId: "power30", present: true, working: true, note: null },
      { serviceId: "water", present: true, working: true, note: "shared" },
    ]);
    expect(d.proposals).toEqual([]);
    expect(d.immediate).toEqual([]);
  });
  it("working and note on an absent service are ignored until presence is approved", () => {
    const d = servicePresenceDiff(current, [{ serviceId: "sewer", present: true, working: false, note: "x" }]);
    expect(d.proposals).toEqual([{ serviceId: "sewer", present: true }]);
    expect(d.immediate).toEqual([]);
  });
});

describe("attribute diff yields proposals for every change", () => {
  // An Attribute is always applicable to a valid type — there is no
  // present/absent toggle — only its value is optional.
  const current = [
    { attributeId: "max_boat", value: 40, note: null },
    { attributeId: "max_vehicle", value: 22, note: "trailers ok" },
  ];
  it("a value change proposes, and clearing a value (to null) proposes too", () => {
    const observed = [
      { attributeId: "max_boat", value: 35, note: null },
      { attributeId: "max_vehicle", value: null, note: null },
      { attributeId: "max_trailer", value: 18, note: null },
    ];
    const d = attributeDiff(current, observed);
    expect(d.proposals).toEqual([
      { attributeId: "max_boat", value: 35, note: null },
      { attributeId: "max_vehicle", value: null, note: null },
      { attributeId: "max_trailer", value: 18, note: null },
    ]);
  });
  it("an unchanged observation produces nothing", () => {
    const d = attributeDiff(current, [
      { attributeId: "max_boat", value: 40, note: null },
      { attributeId: "max_vehicle", value: 22, note: "trailers ok" },
    ]);
    expect(d.proposals).toEqual([]);
  });
  it("a never-set attribute observed as still unset produces nothing", () => {
    const d = attributeDiff(current, [{ attributeId: "max_trailer", value: null, note: null }]);
    expect(d.proposals).toEqual([]);
  });
  it("a note-only change on an already-set attribute still proposes", () => {
    const d = attributeDiff(current, [{ attributeId: "max_boat", value: 40, note: "no houseboats" }]);
    expect(d.proposals).toEqual([{ attributeId: "max_boat", value: 40, note: "no houseboats" }]);
  });
});
