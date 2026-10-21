// Shift report compilation (see src/pages/reports/ShiftReportPage.spec.md,
// docs/architecture.md — Shift report delivery).
//
// Records aren't linked to a shift by reference; association is computed from
// timestamps falling inside the shift's start/end window (per docs/data-model.md
// — Shift). That is not a shortcut: a shift started on one device and walked on
// another has no id to carry, and the window is the only definition that
// survives it. An open shift's window runs to "now", so viewing mid-shift shows
// progress so far. This is the same compilation the send path performs, which
// is why viewing always reflects current data rather than an email snapshot.

export interface ShiftWindow {
  started_at: string | number;
  ended_at?: string | number | null;
}

export function shiftWindowMs(shift: ShiftWindow): { start: number; end: number } {
  return {
    start: new Date(shift.started_at).getTime(),
    end: shift.ended_at ? new Date(shift.ended_at).getTime() : Date.now(),
  };
}

export function withinWindow(
  timestamp: string | number | null | undefined,
  window: { start: number; end: number },
): boolean {
  if (timestamp == null) return false;
  const ts = new Date(timestamp).getTime();
  return ts >= window.start && ts <= window.end;
}

export function formatDuration(window: { start: number; end: number }): string {
  const totalMinutes = Math.max(0, Math.round((window.end - window.start) / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---- Vehicles (src/pages/reports/ShiftReportPage.spec.md § Vehicles)

/** A checkout, with what its vehicle needs to be read. */
export interface VehicleCheckout {
  id: string;
  asset_id: string;
  asset_name: string;
  person_id: string | null;
  time_out: string;
  time_in: string | null;
  odometer_out: number | null;
  odometer_in: number | null;
  fuel_level_in: number | null;
  return_note: string | null;
  kept_after_shift: number | boolean | null;
  has_meter: number;
  meter_type: string | null;
  /** The vehicle's current reading: where a trip still out has got to. */
  meter_reading: number | null;
}

export interface VehicleFuelLog {
  id: string;
  asset_id: string;
  asset_name: string;
  logged_by_id: string | null;
  timestamp: string;
  gallons: number | null;
  cost: number | null;
  level: number | null;
  odometer: number | null;
  has_meter: number;
  meter_type: string | null;
}

/** One trip, or one vehicle only fueled or checked. */
export interface VehicleUse {
  assetId: string;
  name: string;
  /** The meter's type when the vehicle has one, else null: no odometer line. */
  meterType: string | null;
  checkoutId: string | null;
  out: string | null;
  /** The trip continues one kept past the previous Shift's end. */
  keptFromPrevious: boolean;
  end: { kind: "in" | "kept" | "still_out"; at: string | null } | null;
  odometerOut: number | null;
  odometerEnd: number | null;
  distance: number | null;
  fuelBack: number | null;
  /** The return note, unless the trip was kept, when it is the reason. */
  note: string | null;
  keptReason: string | null;
  fills: { at: string; gallons: number; cost: number | null }[];
  statusChecks: { at: string; odometer: number | null; level: number }[];
  firstAt: number;
}

const ms = (t: string) => Date.parse(t);
const flag = (v: number | boolean | null) => v === true || v === 1;

/**
 * Every use of a Fleet Vehicle by one guard in a Shift: their checkouts that
 * overlap the window, and the fill-ups and Status Checks they logged in it.
 * `checkouts` should hold all of the guard's checkouts that might qualify,
 * including the continuation of a kept one, which is how a kept trip is told
 * from a returned one.
 */
export function compileVehicleUse(input: {
  window: { start: number; end: number };
  guardContactId: string | null;
  guardUserId: string;
  checkouts: VehicleCheckout[];
  fuelLogs: VehicleFuelLog[];
}): VehicleUse[] {
  const { window } = input;
  const mine = input.guardContactId
    ? input.checkouts.filter((c) => c.person_id === input.guardContactId)
    : [];
  const continued = (c: VehicleCheckout) =>
    c.time_in != null &&
    mine.some((n) => n.id !== c.id && n.asset_id === c.asset_id && flag(n.kept_after_shift) && ms(n.time_out) === ms(c.time_in!));

  const uses: VehicleUse[] = mine
    .filter((c) => ms(c.time_out) <= window.end && (c.time_in == null || ms(c.time_in) >= window.start))
    // A continuation opened during this Shift is this Shift's keep, already
    // shown as the end of the trip it continues.
    .filter((c) => !(flag(c.kept_after_shift) && ms(c.time_out) >= window.start))
    .map((c) => {
      const kept = continued(c);
      const metered = c.has_meter === 1;
      const odometerEnd = metered ? (c.time_in ? c.odometer_in : c.meter_reading) : null;
      const odometerOut = metered ? c.odometer_out : null;
      return {
        assetId: c.asset_id,
        name: c.asset_name,
        meterType: metered ? c.meter_type : null,
        checkoutId: c.id,
        out: c.time_out,
        keptFromPrevious: flag(c.kept_after_shift),
        end: c.time_in ? { kind: kept ? "kept" : "in", at: c.time_in } : { kind: "still_out", at: null },
        odometerOut,
        odometerEnd,
        distance: odometerOut != null && odometerEnd != null ? odometerEnd - odometerOut : null,
        fuelBack: c.fuel_level_in,
        note: kept ? null : c.return_note,
        keptReason: kept ? c.return_note : null,
        fills: [],
        statusChecks: [],
        firstAt: ms(c.time_out),
      } satisfies VehicleUse;
    });

  const logs = input.fuelLogs
    .filter((f) => f.logged_by_id === input.guardUserId && withinWindow(f.timestamp, window))
    .sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
  for (const f of logs) {
    const at = ms(f.timestamp);
    let use = uses.find(
      (u) => u.assetId === f.asset_id && u.out != null && ms(u.out) <= at && (u.end?.at == null || at <= ms(u.end.at)),
    ) ?? uses.find((u) => u.assetId === f.asset_id && u.checkoutId == null);
    if (!use) {
      use = {
        assetId: f.asset_id,
        name: f.asset_name,
        meterType: f.has_meter === 1 ? f.meter_type : null,
        checkoutId: null,
        out: null,
        keptFromPrevious: false,
        end: null,
        odometerOut: null,
        odometerEnd: null,
        distance: null,
        fuelBack: null,
        note: null,
        keptReason: null,
        fills: [],
        statusChecks: [],
        firstAt: at,
      };
      uses.push(use);
    }
    if (f.gallons != null) use.fills.push({ at: f.timestamp, gallons: f.gallons, cost: f.cost });
    if (f.level != null) use.statusChecks.push({ at: f.timestamp, odometer: f.odometer, level: f.level });
  }

  return uses.sort((a, b) => a.firstAt - b.firstAt);
}
