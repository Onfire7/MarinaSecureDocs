// Synthetic occupancy.
//
// The Instant export carries real configuration and essentially no operational
// data: 0 boats, 0 vehicles, 0 leases, 1 contact. Occupancy sync scoping is
// defined against exactly those tables (docs/architecture.md — What is
// resident), so without this it cannot be exercised at all.
//
// Sizing comes from the real marina: 800 leased slips, 30 cabins turning over
// weekly, 100 camping spots turning over biweekly, roughly two contacts each.
// That yields ~1,860 contacts present at any moment against ~8,300 created a
// year — a 4.5x ratio that grows every year, and the reason "sync all
// contacts" is not an option.
//
// Everything is deterministic under a fixed faker seed, so the same marina
// comes back every run and a bug reproduces.

import { faker } from "@faker-js/faker";
import { detUuid } from "./transform.mjs";
import * as marina from "./generators/marina.mjs";

const SEED = 20260826;

// The marina as it actually is, versus what the export has entered so far.
const TARGET = { Slip: 800, Cabin: 30, Campsite: 100 };
const NOW = new Date("2026-08-26T12:00:00Z");
const YEAR_AGO = new Date("2025-08-26T12:00:00Z");
const DAY = 86_400_000;

const iso = (d) => new Date(d).toISOString();
const pick = (a) => faker.helpers.arrayElement(a);

export function generateOccupancy(config) {
  faker.seed(SEED);

  const tables = {};
  const deferred = [];
  const push = (t, ...rows) => { (tables[t] ??= []).push(...rows); };

  const typeByName = new Map((config.location_types ?? []).map((t) => [t.name, t]));
  const locations = config.locations ?? [];
  const root = locations.find((l) => typeByName.get("Marina")?.id === l.location_type_id) ?? locations[0];
  const existing = (name) => locations.filter((l) => l.location_type_id === typeByName.get(name)?.id);
  const vacantStatus = (config.location_statuses ?? [])[0]?.id ?? null;

  // ── top the property up to its real size ────────────────────────────────
  const rentable = { Slip: [], Cabin: [], Campsite: [] };
  for (const [typeName, target] of Object.entries(TARGET)) {
    const have = existing(typeName);
    rentable[typeName].push(...have.map((l) => l.id));
    const typeId = typeByName.get(typeName)?.id;
    if (!typeId) continue;
    for (let i = have.length; i < target; i++) {
      const id = detUuid(`synthetic:${typeName}:${i}`);
      const name =
        typeName === "Slip"     ? `${marina.dockName(Math.floor(i / 40))} ${marina.slipName(i + 1)}`
      : typeName === "Cabin"    ? marina.cabinName(i + 1)
      : `${marina.campLoopName(Math.floor(i / 25))} ${marina.campsiteName(i + 1)}`;
      push("locations", {
        id, name, location_type_id: typeId, parent_id: null,
        status_id: vacantStatus, post_reservation_status_id: null,
        reservation_enabled: typeName !== "Slip",
        reservation_visibility: null,
        lease_enabled: typeName === "Slip",
        gps_lat: null, gps_lng: null,
        current_boat_id: null, current_vehicle_id: null,
      });
      if (root) deferred.push({ table: "locations", id, set: { parent_id: root.id } });
      rentable[typeName].push(id);
    }
  }

  // ── contacts ────────────────────────────────────────────────────────────
  let contactSeq = 0;
  const newContact = () => {
    const id = detUuid(`synthetic:contact:${contactSeq++}`);
    push("contacts", { id, name: faker.person.fullName(), merged_into_id: null });
    push("contact_details", {
      contact_id: id, phone: marina.usPhone(),
      email: faker.internet.email().toLowerCase(), address: null,
    });
    return id;
  };

  // ── leases: slips, held long-term, rarely changing ──────────────────────
  // 92% occupancy — a marina with every slip full is a marina that is not
  // real, and the vacant ones are what prove the scope excludes anything.
  let boatSeq = 0;
  for (const [i, locationId] of rentable.Slip.entries()) {
    if (faker.number.int({ min: 1, max: 100 }) > 92) continue;
    const leaseId = detUuid(`synthetic:lease:${i}`);
    const lessees = [newContact(), ...(faker.datatype.boolean(0.75) ? [newContact()] : [])];
    // Started 1-6 years ago, running 6-24 months into the future.
    const start = new Date(NOW.getTime() - faker.number.int({ min: 365, max: 2190 }) * DAY);
    const end = new Date(NOW.getTime() + faker.number.int({ min: 180, max: 730 }) * DAY);
    push("leases", {
      id: leaseId, location_id: locationId,
      start_date: iso(start), end_date: iso(end),
      variances_and_conditions: faker.datatype.boolean(0.15)
        ? "Winter haul-out included. Owner stores cradle on site." : null,
    });
    for (const contact_id of lessees) push("lease_lessees", { lease_id: leaseId, contact_id });

    // The boat that lives in the slip.
    const { make, model } = marina.boatMakeModel();
    const boatId = detUuid(`synthetic:boat:${boatSeq++}`);
    push("boats", {
      id: boatId, name: marina.boatName(), description: null,
      length: marina.boatLengthFt(), make, model,
      registration_number: marina.registrationNumber(),
    });
    lessees.forEach((contact_id, pos) => push("boat_owners", { boat_id: boatId, contact_id, position: pos }));
    deferred.push({ table: "locations", id: locationId, set: { current_boat_id: boatId } });
  }

  // ── reservations: a full year of cabin and camping turnover ─────────────
  // This is the churn that makes occupancy scoping necessary. Cabins flip
  // weekly, campsites every two weeks, and each stay brings new contacts who
  // are never seen again.
  let resSeq = 0, vehSeq = 0;
  const stay = (locationId, startMs, nights) => {
    const start = new Date(startMs);
    const end = new Date(startMs + nights * DAY);
    const contact_id = newContact();
    if (faker.datatype.boolean(0.6)) newContact();          // travelling companion
    const past = end < NOW;
    const current = start <= NOW && end >= NOW;
    push("reservations", {
      id: detUuid(`synthetic:reservation:${resSeq++}`),
      status: past ? "checked_out" : current ? "checked_in" : "confirmed",
      contact_id, location_id: locationId, asset_id: null,
      billing_type: "billable",
      expected_checkin: iso(start), expected_checkout: iso(end),
      actual_checkin: past || current ? iso(start) : null,
      actual_checkout: past ? iso(end) : null,
      early_checkin: null, late_checkout: null,
      rate: faker.number.int({ min: 45, max: 240 }),
      deposit: faker.datatype.boolean(0.4) ? 100 : null, balance: 0,
    });
    if (current && faker.datatype.boolean(0.8)) {
      const vid = detUuid(`synthetic:vehicle:${vehSeq++}`);
      push("vehicles", {
        id: vid,
        description: `${faker.vehicle.color()} ${faker.vehicle.manufacturer()} ${faker.vehicle.model()}`,
        plate_number: faker.vehicle.vrm(),
      });
      push("vehicle_owners", { vehicle_id: vid, contact_id, position: 0 });
      deferred.push({ table: "locations", id: locationId, set: { current_vehicle_id: vid } });
    }
  };

  for (const locationId of rentable.Cabin) {
    for (let t = YEAR_AGO.getTime(); t < NOW.getTime() + 21 * DAY; t += 7 * DAY) {
      stay(locationId, t, faker.number.int({ min: 2, max: 7 }));
    }
  }
  for (const locationId of rentable.Campsite) {
    for (let t = YEAR_AGO.getTime(); t < NOW.getTime() + 21 * DAY; t += 14 * DAY) {
      stay(locationId, t, faker.number.int({ min: 2, max: 10 }));
    }
  }

  // ── a year of security rounds ───────────────────────────────────────────
  // Age-scoped in sync, and the reason the activity log needs a retention
  // policy at all.
  const checkpoints = (config.checkpoints ?? []).map((c) => c.id);
  const guard = (config.users ?? [])[0]?.id ?? null;
  let ciSeq = 0, alSeq = 0;
  if (checkpoints.length && guard) {
    for (let day = 0; day < 365; day++) {
      const base = YEAR_AGO.getTime() + day * DAY;
      for (const round of [22, 2]) {                       // two rounds a night
        for (const checkpoint_id of faker.helpers.arrayElements(checkpoints, { min: 8, max: 18 })) {
          const at = base + round * 3_600_000 + faker.number.int({ min: 0, max: 3_000_000 });
          push("check_ins", {
            id: detUuid(`synthetic:checkin:${ciSeq++}`),
            checkpoint_id, user_id: guard, timestamp: iso(at),
            method: faker.datatype.boolean(0.93) ? "scanned" : "manual",
            reason: null, gps_lat: null, gps_lng: null, within_radius: true,
          });
        }
      }
    }
    // Manual check-ins must carry a reason — the database enforces what the
    // app only asserted.
    for (const ci of tables.check_ins ?? []) {
      if (ci.method === "manual") ci.reason = pick(["Tag unreadable", "Phone NFC off", "Gate propped open"]);
    }
    for (const ci of faker.helpers.arrayElements(tables.check_ins ?? [], Math.floor((tables.check_ins ?? []).length * 0.6))) {
      push("activity_log_entries", {
        id: detUuid(`synthetic:activity:${alSeq++}`),
        event_type: "checkin.created", summary: `Check-in recorded`,
        timestamp: ci.timestamp, protected: false,
        subject_type: "check_ins", subject_id: ci.id, actor_id: guard,
      });
    }
  }

  return { tables, deferred };
}
