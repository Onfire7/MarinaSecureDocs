import { describe, expect, it } from "vitest";
import {
  boardOrder,
  fleetGroup,
  holderName,
  lastFuelLevel,
  readingChange,
  tripDistance,
} from "./fleet";

// Fleet card tests 1–5 (src/pages/home/FleetCard.spec.md).

const ME = "contact-me";

function vehicle(
  name: string,
  over: Partial<{
    status_name: string | null;
    checkout_id: string | null;
    checkout_person_id: string | null;
  }> = {},
) {
  return {
    name,
    status_name: "Available",
    checkout_id: null,
    checkout_person_id: null,
    ...over,
  };
}

describe("boardOrder (test 1)", () => {
  const mine = (name: string) => vehicle(name, { checkout_id: `co-${name}`, checkout_person_id: ME });
  const theirs = (name: string) =>
    vehicle(name, { checkout_id: `co-${name}`, checkout_person_id: "contact-dana" });
  const broken = (name: string) => vehicle(name, { status_name: "Out of Service" });

  it("puts yours first, then available, then with someone else, then out of service, by name within each", () => {
    const board = boardOrder(
      [
        broken("Zamboni"),
        theirs("Van"),
        vehicle("Truck"),
        mine("Cart 2"),
        broken("Boat trailer"),
        vehicle("Cart 1"),
        theirs("Ambulance"),
        mine("Cart 10"),
      ],
      ME,
    );
    expect(board.map((v) => v.name)).toEqual([
      "Cart 2",
      "Cart 10",
      "Cart 1",
      "Truck",
      "Ambulance",
      "Van",
      "Boat trailer",
      "Zamboni",
    ]);
  });

  it("counts a vehicle checked out to you by someone else as yours", () => {
    expect(fleetGroup(mine("Truck"), ME)).toBe("yours");
  });

  it("puts an out-of-service vehicle in that group whoever holds it, whatever the status name's case", () => {
    expect(fleetGroup(vehicle("Truck", { status_name: "out of service", checkout_id: "co", checkout_person_id: ME }), ME)).toBe(
      "out_of_service",
    );
    expect(fleetGroup(vehicle("Truck", { status_name: "Needs Service" }), ME)).toBe("available");
    expect(fleetGroup(vehicle("Truck", { status_name: null }), ME)).toBe("available");
  });

  it("has nothing that is yours for a user with no contact", () => {
    expect(fleetGroup(theirs("Truck"), null)).toBe("others");
    expect(fleetGroup(vehicle("Truck", { checkout_id: "co", checkout_person_id: null }), null)).toBe("others");
  });
});

describe("lastFuelLevel (test 2)", () => {
  it("is the level recorded at check-in when that is the latest", () => {
    expect(
      lastFuelLevel({ at: "2026-10-20T10:00:00Z", level: 1 }, "2026-10-19T10:00:00Z"),
    ).toBe(1);
  });

  it("is full when a fill-up is the latest", () => {
    expect(
      lastFuelLevel({ at: "2026-10-20T10:00:00Z", level: 1 }, "2026-10-20T11:00:00Z"),
    ).toBe(4);
    expect(lastFuelLevel(null, "2026-10-20T11:00:00Z")).toBe(4);
  });

  it("keeps an empty tank at empty rather than treating it as unknown", () => {
    expect(lastFuelLevel({ at: "2026-10-20T10:00:00Z", level: 0 }, null)).toBe(0);
  });

  it("is unknown with no record of either", () => {
    expect(lastFuelLevel(null, null)).toBeNull();
  });
});

describe("tripDistance (test 3)", () => {
  const truck = { has_meter: 1, meter_reading: 1048 };

  it("is the current odometer less the starting one", () => {
    expect(tripDistance(truck, 1033)).toBe(15);
  });

  it("has no figure without a meter, a starting odometer or a reading", () => {
    expect(tripDistance({ has_meter: 0, meter_reading: 12 }, 3)).toBeNull();
    expect(tripDistance(truck, null)).toBeNull();
    expect(tripDistance({ has_meter: 1, meter_reading: null }, 1033)).toBeNull();
  });
});

describe("readingChange (test 4)", () => {
  it("records a higher reading", () => {
    expect(readingChange(1000, 1012)).toBe("record");
  });

  it("records nothing for an unchanged or empty one", () => {
    expect(readingChange(1000, 1000)).toBe("none");
    expect(readingChange(1000, null)).toBe("none");
  });

  it("needs a correction reason for a lower one", () => {
    expect(readingChange(1000, 990)).toBe("correction");
  });

  it("records the first reading a vehicle has ever had", () => {
    expect(readingChange(null, 5)).toBe("record");
  });
});

describe("holderName (test 5)", () => {
  const users = [
    { name: "Dana R.", contact_id: "contact-dana" },
    { name: "No Contact", contact_id: null },
  ];

  it("names the user whose contact holds the vehicle", () => {
    expect(holderName("contact-dana", users, "Dana Rivera (contact)")).toBe("Dana R.");
  });

  it("falls back to the contact's own name", () => {
    expect(holderName("contact-guest", users, "Pat Guest")).toBe("Pat Guest");
  });

  it("falls back to Checked out when neither is on the device", () => {
    expect(holderName("contact-guest", users, null)).toBe("Checked out");
    expect(holderName(null, users, null)).toBe("Checked out");
  });
});
