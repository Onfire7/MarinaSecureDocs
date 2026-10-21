import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileVehicleUse,
  formatDuration,
  shiftWindowMs,
  withinWindow,
  type VehicleCheckout,
  type VehicleFuelLog,
  type VehicleMeterReading,
  type VehicleRaised,
  type VehicleStatusLog,
} from "./shiftReport";

const START = Date.UTC(2026, 7, 24, 18, 9, 0);

afterEach(() => vi.useRealTimers());

describe("shiftWindowMs", () => {
  it("ends an open shift at now, so mid-shift views show progress so far", () => {
    const now = START + 8 * 3_600_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(shiftWindowMs({ started_at: START })).toEqual({ start: START, end: now });
    expect(shiftWindowMs({ started_at: START, ended_at: null })).toEqual({ start: START, end: now });
  });

  it("ends a closed shift at endedAt", () => {
    const ended = START + 3_600_000;
    expect(shiftWindowMs({ started_at: START, ended_at: ended })).toEqual({
      start: START,
      end: ended,
    });
  });

  it("accepts ISO strings as well as epoch numbers", () => {
    expect(
      shiftWindowMs({
        started_at: new Date(START).toISOString(),
        ended_at: new Date(START + 60_000).toISOString(),
      }),
    ).toEqual({ start: START, end: START + 60_000 });
  });
});

describe("withinWindow", () => {
  const window = { start: 1000, end: 2000 };

  it("includes both boundaries", () => {
    // Records associate with a shift by timestamp, not by reference — an
    // exclusive boundary would drop the check-in made at the exact moment a
    // shift started.
    expect(withinWindow(1000, window)).toBe(true);
    expect(withinWindow(2000, window)).toBe(true);
  });

  it("excludes timestamps outside the window", () => {
    expect(withinWindow(999, window)).toBe(false);
    expect(withinWindow(2001, window)).toBe(false);
  });

  it("excludes a missing timestamp rather than counting it", () => {
    expect(withinWindow(null, window)).toBe(false);
    expect(withinWindow(undefined, window)).toBe(false);
  });
});

describe("formatDuration", () => {
  it("renders hours and minutes, or minutes alone", () => {
    expect(formatDuration({ start: 0, end: 8 * 3_600_000 + 14 * 60_000 })).toBe("8h 14m");
    expect(formatDuration({ start: 0, end: 45 * 60_000 })).toBe("45m");
    expect(formatDuration({ start: 0, end: 3_600_000 })).toBe("1h 0m");
  });

  it("clamps a negative window to zero", () => {
    expect(formatDuration({ start: 1000, end: 0 })).toBe("0m");
  });
});

// Fleet Vehicle Item test 7 (src/pages/reports/ShiftReportPage.spec.md § Vehicles).
describe("compileVehicleUse (test 7)", () => {
  const t = (hhmm: string, day = 20) => `2026-10-${day}T${hhmm}:00.000Z`;
  const window = { start: Date.parse(t("22:00")), end: Date.parse(t("06:00", 21)) };
  const GUARD_CONTACT = "contact-gail";
  const GUARD_USER = "user-gail";

  const checkout = (over: Partial<VehicleCheckout>): VehicleCheckout => ({
    id: "co",
    asset_id: "truck",
    asset_name: "Truck 2",
    person_id: GUARD_CONTACT,
    time_out: t("22:30"),
    time_in: null,
    odometer_out: 48000,
    odometer_in: null,
    fuel_level_in: null,
    return_note: null,
    kept_after_shift: 0,
    has_meter: 1,
    meter_type: "mileage",
    meter_reading: 48030,
    ...over,
  });
  const fuel = (over: Partial<VehicleFuelLog>): VehicleFuelLog => ({
    id: "f",
    asset_id: "truck",
    asset_name: "Truck 2",
    logged_by_id: GUARD_USER,
    timestamp: t("23:30"),
    gallons: null,
    cost: null,
    level: null,
    odometer: null,
    has_meter: 1,
    meter_type: "mileage",
    ...over,
  });
  const compile = (
    checkouts: VehicleCheckout[],
    fuelLogs: VehicleFuelLog[] = [],
    more: { statusLogs?: VehicleStatusLog[]; readings?: VehicleMeterReading[]; raised?: VehicleRaised[] } = {},
  ) =>
    compileVehicleUse({
      window,
      guardContactId: GUARD_CONTACT,
      guardUserId: GUARD_USER,
      checkouts,
      fuelLogs,
      statusLogs: more.statusLogs ?? [],
      readings: more.readings ?? [],
      raised: more.raised ?? [],
    });
  const status = (over: Partial<VehicleStatusLog>): VehicleStatusLog => ({
    id: "s",
    asset_id: "truck",
    asset_name: "Truck 2",
    status_name: "Needs Cleaning",
    note: null,
    timestamp: t("05:58", 21),
    logged_by_id: GUARD_USER,
    has_meter: 1,
    meter_type: "mileage",
    ...over,
  });
  const reading = (over: Partial<VehicleMeterReading>): VehicleMeterReading => ({
    id: "r",
    asset_id: "cart",
    asset_name: "Golf Cart 1",
    value: 18240,
    timestamp: t("02:10", 21),
    logged_by_id: GUARD_USER,
    has_meter: 1,
    meter_type: "mileage",
    ...over,
  });
  const raised = (over: Partial<VehicleRaised>): VehicleRaised => ({
    kind: "incident",
    id: "inc-1",
    asset_id: "truck",
    asset_name: "Truck 2",
    title: "Scraped mirror on the gate post",
    created_at: t("01:15", 21),
    created_by_id: GUARD_USER,
    has_meter: 1,
    meter_type: "mileage",
    ...over,
  });

  it("counts checkouts overlapping the shift, including one taken before it started", () => {
    const uses = compile([
      checkout({ id: "before", time_out: t("20:00"), time_in: t("23:00"), odometer_in: 48010, fuel_level_in: 2 }),
      checkout({ id: "after-end", time_out: t("07:00", 21) }),
      checkout({ id: "done-before", time_out: t("18:00"), time_in: t("21:00") }),
      checkout({ id: "someone-else", person_id: "contact-dana" }),
    ]);
    expect(uses.map((u) => u.checkoutId)).toEqual(["before"]);
    expect(uses[0]).toMatchObject({
      out: t("20:00"),
      end: { kind: "in", at: t("23:00") },
      odometerOut: 48000,
      odometerEnd: 48010,
      distance: 10,
      fuelBack: 2,
    });
  });

  it("ends a vehicle still out at its latest reading", () => {
    expect(compile([checkout({ id: "out" })])[0]).toMatchObject({
      end: { kind: "still_out", at: null },
      odometerEnd: 48030,
      distance: 30,
    });
  });

  it("reads a closed-and-continued pair as kept, with the reason, and leaves out the continuation", () => {
    const uses = compile([
      checkout({
        id: "a",
        time_in: t("05:50", 21),
        odometer_in: 48062,
        fuel_level_in: 2,
        return_note: "Covering the 6 AM gate run",
      }),
      checkout({ id: "b", time_out: t("05:50", 21), odometer_out: 48062, kept_after_shift: 1 }),
    ]);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({
      checkoutId: "a",
      end: { kind: "kept", at: t("05:50", 21) },
      keptReason: "Covering the 6 AM gate run",
      note: null,
      fuelBack: 2,
      distance: 62,
    });
  });

  it("reads a checkout kept from the previous shift as such", () => {
    expect(
      compile([checkout({ id: "b", time_out: t("21:50"), kept_after_shift: 1 })])[0],
    ).toMatchObject({ checkoutId: "b", keptFromPrevious: true });
  });

  it("attaches the guard's fill-ups and Status Checks to the trip, as soon as they are recorded", () => {
    const [use] = compile(
      [checkout({ id: "trip" })],
      [
        fuel({ id: "fill", timestamp: t("23:30"), gallons: 9.5, cost: 31.2, level: 4, odometer: 48020 }),
        fuel({ id: "check", timestamp: t("01:00", 21), level: 3, odometer: 48025 }),
        fuel({ id: "dana", logged_by_id: "user-dana", gallons: 5 }),
        fuel({ id: "early", timestamp: t("21:00"), gallons: 5 }),
      ],
    );
    expect(use.fills).toEqual([{ at: t("23:30"), gallons: 9.5, cost: 31.2 }]);
    expect(use.statusChecks).toEqual([
      { at: t("23:30"), odometer: 48020, level: 4 },
      { at: t("01:00", 21), odometer: 48025, level: 3 },
    ]);
  });

  it("gives a vehicle only fueled or checked an entry of its own, with no time span", () => {
    const [use] = compile([], [fuel({ asset_id: "cart", asset_name: "Golf Cart 1", level: 2 })]);
    expect(use).toMatchObject({ assetId: "cart", name: "Golf Cart 1", checkoutId: null, out: null, end: null });
    expect(use.statusChecks).toHaveLength(1);
  });

  it("orders entries by first use", () => {
    const uses = compile(
      [checkout({ id: "late", asset_id: "van", asset_name: "Van", time_out: t("02:00", 21) }), checkout({ id: "early" })],
      [fuel({ asset_id: "cart", asset_name: "Golf Cart 1", timestamp: t("23:00"), level: 2 })],
    );
    expect(uses.map((u) => u.name)).toEqual(["Truck 2", "Golf Cart 1", "Van"]);
  });
  // Tests 1-5 of the approved list for § Vehicles' status, readings and
  // pointers (ShiftReportPage.spec.md, settled 2026-10-21).
  it("1. attaches the guard's status changes to the trip, or to an entry of the vehicle's own", () => {
    const uses = compile([checkout({ time_in: t("05:58", 21), odometer_in: 48040, fuel_level_in: 2 })], [], {
      statusLogs: [
        status({ id: "during", timestamp: t("03:00", 21), note: "Mud on the seats" }),
        status({ id: "cart-oos", asset_id: "cart", asset_name: "Golf Cart 1", status_name: "Out of Service", timestamp: t("04:00", 21) }),
        status({ id: "someone-else", timestamp: t("03:30", 21), logged_by_id: "user-other" }),
        status({ id: "yesterday", timestamp: t("12:00", 20) }),
      ],
    });
    expect(uses.map((u) => u.name)).toEqual(["Truck 2", "Golf Cart 1"]);
    expect(uses[0].statuses).toEqual([{ at: t("03:00", 21), name: "Needs Cleaning", note: "Mud on the seats" }]);
    expect(uses[1].checkoutId).toBeNull();
    expect(uses[1].statuses).toEqual([{ at: t("04:00", 21), name: "Out of Service", note: null }]);
  });

  it("2. counts a check-in's post-return status, stamped at the moment the trip ended", () => {
    const uses = compile([checkout({ time_in: t("05:58", 21), odometer_in: 48040, fuel_level_in: 2 })], [], {
      statusLogs: [status({ timestamp: t("05:58", 21), note: "Returned from checkout" })],
    });
    expect(uses).toHaveLength(1);
    expect(uses[0].statuses.map((x) => x.name)).toEqual(["Needs Cleaning"]);
  });

  it("3. shows a reading the guard logged on a vehicle they never took, and never one a trip already shows", () => {
    const uses = compile(
      [checkout({ time_in: t("05:58", 21), odometer_in: 48040, fuel_level_in: 2 })],
      [fuel({ timestamp: t("23:30"), level: 3, odometer: 48010 })],
      {
        readings: [
          reading({ id: "cart-standalone" }),
          reading({ id: "truck-out", asset_id: "truck", asset_name: "Truck 2", value: 48000, timestamp: t("22:30") }),
          reading({ id: "truck-in", asset_id: "truck", asset_name: "Truck 2", value: 48040, timestamp: t("05:58", 21) }),
          reading({ id: "truck-status-check", asset_id: "truck", asset_name: "Truck 2", value: 48010, timestamp: t("23:30") }),
          reading({ id: "truck-mid", asset_id: "truck", asset_name: "Truck 2", value: 48020, timestamp: t("01:00", 21) }),
          reading({ id: "not-mine", logged_by_id: "user-other", timestamp: t("02:20", 21) }),
        ],
      },
    );
    const truck = uses.find((u) => u.name === "Truck 2")!;
    const cart = uses.find((u) => u.name === "Golf Cart 1")!;
    expect(truck.readings).toEqual([{ at: t("01:00", 21), value: 48020 }]);
    expect(cart.readings).toEqual([{ at: t("02:10", 21), value: 18240 }]);
  });

  it("4. points at the incidents and tickets the guard raised on the vehicle, and no others", () => {
    const uses = compile([checkout({})], [], {
      raised: [
        raised({}),
        raised({ kind: "ticket", id: "tkt-1", title: "Replace mirror", created_at: t("01:20", 21) }),
        raised({ id: "other-guard", created_by_id: "user-other" }),
        raised({ id: "other-asset", asset_id: "van", asset_name: "Van", created_at: t("01:30", 21), created_by_id: "user-other" }),
      ],
    });
    expect(uses).toHaveLength(1);
    expect(uses[0].raised).toEqual([
      { kind: "incident", id: "inc-1", title: "Scraped mirror on the gate post", at: t("01:15", 21) },
      { kind: "ticket", id: "tkt-1", title: "Replace mirror", at: t("01:20", 21) },
    ]);
  });

  it("5. orders a vehicle known only by a status change by that time, against trips", () => {
    const uses = compile([checkout({ time_out: t("02:00", 21) })], [], {
      statusLogs: [status({ asset_id: "cart", asset_name: "Golf Cart 1", status_name: "Out of Service", timestamp: t("23:15") })],
    });
    expect(uses.map((u) => u.name)).toEqual(["Golf Cart 1", "Truck 2"]);
  });
});
