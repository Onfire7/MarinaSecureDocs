import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import { ITEM_TYPE_LABEL } from "./checklists";
import {
  FLEET_ITEM_MODES,
  fleetDefaultLabelKey,
  fleetItemMode,
  pickable,
  returnAnswer,
  returnTarget,
  statusCheckWrites,
  statusUndoReading,
  takeAnswer,
  undoCheckinBlocked,
  undoCheckoutBlocked,
  type FleetVehicleResult,
  type HeldCheckout,
} from "./fleetItem";

// Fleet Vehicle Item tests 1, 2, 3, 5, 9 and 10
// (src/pages/checklists/ActiveChecklistPage.spec.md § Fleet Vehicle Item).

const held = (id: string, timeOut: string, over: Partial<HeldCheckout> = {}): HeldCheckout => ({
  id,
  asset_id: `asset-${id}`,
  time_out: timeOut,
  kept_after_shift: 0,
  ...over,
});

describe("takeAnswer (test 1)", () => {
  const saved: FleetVehicleResult = { type: "fleet_vehicle", mode: "take", none: true };

  it("is the saved answer whenever there is one", () => {
    expect(takeAnswer(saved, [held("a", "2026-10-20T22:00:00Z")])).toEqual({
      source: "saved",
      result: saved,
    });
  });

  it("is answered by circumstance by a vehicle already in hand, the earliest taken first", () => {
    expect(
      takeAnswer(null, [held("later", "2026-10-20T23:00:00Z"), held("earlier", "2026-10-20T22:00:00Z")]),
    ).toEqual({
      source: "circumstance",
      result: { type: "fleet_vehicle", mode: "take", checkoutId: "earlier", assetId: "asset-earlier" },
    });
  });

  it("counts a checkout kept from the previous shift as a vehicle in hand", () => {
    expect(takeAnswer(null, [held("kept", "2026-10-20T06:00:00Z", { kept_after_shift: 1 })])?.source).toBe(
      "circumstance",
    );
  });

  it("is unanswered holding nothing", () => {
    expect(takeAnswer(null, [])).toBeNull();
  });
});

describe("returnAnswer (test 2)", () => {
  const returned: FleetVehicleResult = {
    type: "fleet_vehicle",
    mode: "return",
    checkoutId: "co-1",
    assetId: "truck",
  };

  it("is unanswered while the guard holds a vehicle, even with a saved check-in of another", () => {
    expect(returnAnswer(null, [held("a", "2026-10-20T22:00:00Z")], [])).toBeNull();
    expect(returnAnswer(returned, [held("b", "2026-10-20T22:30:00Z")], [])).toBeNull();
  });

  it("is the saved check-in once nothing is held", () => {
    expect(returnAnswer(returned, [], [])).toEqual({ source: "saved", result: returned });
  });

  it("shows a check-in made elsewhere this shift, the latest", () => {
    expect(
      returnAnswer(null, [], [
        { id: "co-early", asset_id: "cart", time_in: "2026-10-20T23:00:00Z" },
        { id: "co-late", asset_id: "truck", time_in: "2026-10-21T02:00:00Z" },
      ]),
    ).toEqual({
      source: "circumstance",
      result: { type: "fleet_vehicle", mode: "return", checkoutId: "co-late", assetId: "truck" },
    });
  });

  it("is Nothing to return when nothing is held or was returned", () => {
    expect(returnAnswer(null, [], [])).toEqual({
      source: "circumstance",
      result: { type: "fleet_vehicle", mode: "return", nothing: true },
    });
  });

  it("returns two vehicles held at once earliest first", () => {
    expect(
      returnTarget([held("later", "2026-10-20T23:00:00Z"), held("earlier", "2026-10-20T22:00:00Z")])?.id,
    ).toBe("earlier");
    expect(returnTarget([])).toBeNull();
  });
});

describe("undo rules (test 3)", () => {
  const take = { checkoutId: "co-1", checkoutOpen: true };

  it("refuses to undo a checkout while the Return item holds its check-in", () => {
    const returnSaved: FleetVehicleResult = {
      type: "fleet_vehicle",
      mode: "return",
      checkoutId: "co-1",
      assetId: "truck",
    };
    expect(undoCheckoutBlocked({ ...take, checkoutOpen: false, returnSaved })).toBe("returnFirst");
  });

  it("refuses to undo a checkout that has been checked in anywhere", () => {
    expect(undoCheckoutBlocked({ ...take, checkoutOpen: false, returnSaved: null })).toBe("returnFirst");
  });

  it("allows undoing an open checkout", () => {
    expect(undoCheckoutBlocked({ ...take, returnSaved: null })).toBeNull();
  });

  it("refuses to undo a check-in once the vehicle is out again, to anyone", () => {
    expect(undoCheckinBlocked({ vehicleHasOpenCheckout: true })).toBe("checkedOutAgain");
    expect(undoCheckinBlocked({ vehicleHasOpenCheckout: false })).toBeNull();
  });

  it("restores the previous reading only if the vehicle still shows this Status Check's", () => {
    const status: FleetVehicleResult = {
      type: "fleet_vehicle",
      mode: "status",
      assetId: "truck",
      odometer: 48240,
      fuelLevel: 4,
      fuelLogId: "f1",
      meterReadingId: "m1",
      previousReading: 48211,
    };
    expect(statusUndoReading(48240, status)).toEqual({ restore: 48211 });
    expect(statusUndoReading(48300, status)).toEqual({ restore: null });
    expect(statusUndoReading(48240, { ...status, meterReadingId: null })).toEqual({ restore: null });
  });
});

describe("pickable (test 5)", () => {
  it("lets Take and Status Check tap only available vehicles", () => {
    for (const mode of ["take", "status"] as const) {
      expect(pickable(mode, "available")).toBe(true);
      expect(pickable(mode, "others")).toBe(false);
      expect(pickable(mode, "out_of_service")).toBe(false);
      expect(pickable(mode, "yours")).toBe(false);
    }
  });

  it("never offers the board for Return", () => {
    expect(pickable("return", "available")).toBe(false);
  });
});

describe("statusCheckWrites (test 9)", () => {
  const truck = { has_meter: 1, meter_reading: 48211 };

  it("writes one fuel row with the level, and gallons and cost for a fill-up", () => {
    expect(
      statusCheckWrites(truck, {
        odometer: 48240,
        correctionReason: null,
        fuelLevel: 4,
        fill: { gallons: 9.5, cost: 31.2 },
      }),
    ).toEqual({
      reading: "record",
      fuelLog: { level: 4, gallons: 9.5, cost: 31.2, odometer: 48240 },
    });
  });

  it("writes no meter reading when the odometer is unchanged", () => {
    expect(
      statusCheckWrites(truck, { odometer: 48211, correctionReason: null, fuelLevel: 2, fill: null }),
    ).toEqual({
      reading: "none",
      fuelLog: { level: 2, gallons: null, cost: null, odometer: 48211 },
    });
  });

  it("needs a correction reason below the current reading", () => {
    expect(() =>
      statusCheckWrites(truck, { odometer: 48000, correctionReason: " ", fuelLevel: 2, fill: null }),
    ).toThrow();
    expect(
      statusCheckWrites(truck, { odometer: 48000, correctionReason: "Typo", fuelLevel: 2, fill: null }).reading,
    ).toBe("correction");
  });

  it("reads no odometer from a vehicle without a meter", () => {
    expect(
      statusCheckWrites({ has_meter: 0, meter_reading: null }, {
        odometer: null,
        correctionReason: null,
        fuelLevel: 3,
        fill: null,
      }),
    ).toEqual({ reading: "none", fuelLog: { level: 3, gallons: null, cost: null, odometer: null } });
  });
});

describe("item type and modes (test 10)", () => {
  it("names the type", () => {
    expect(ITEM_TYPE_LABEL.fleet_vehicle).toBe("Fleet Vehicle");
  });

  it("gives each mode its default label", () => {
    const labels = Object.fromEntries(
      FLEET_ITEM_MODES.map((m) => {
        const [, group, mode] = fleetDefaultLabelKey(m).split(".");
        return [m, (en.checklists.fleet as unknown as Record<string, Record<string, string>>)[group][mode]];
      }),
    );
    expect(labels).toEqual({
      take: "Take a vehicle",
      status: "Vehicle status check",
      return: "Return your vehicle",
    });
  });

  it("reads a config with no mode as Take", () => {
    expect(fleetItemMode({})).toBe("take");
    expect(fleetItemMode({ mode: "status" })).toBe("status");
    expect(fleetItemMode({ mode: "bogus" as never })).toBe("take");
  });
});
