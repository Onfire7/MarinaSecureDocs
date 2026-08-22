#!/usr/bin/env node
// One-off migration: turn the new leasable flags on wherever a lease already
// exists, so nothing that is leased today stops looking leasable.
//
// Leases used to attach to any location at all — there was no capability
// flag and no per-location switch, so the lease picker offered root
// properties and grouping docks alongside real slips. LocationType gains
// `allowsLeases` and Location gains `leaseEnabled`, mirroring the pair that
// already governs reservations. Both default to absent, which reads as off,
// so without this pass every existing lease would sit on a location the UI
// now calls un-leasable, and its "+ Add a lease" button would be gone.
//
// What this writes:
//   Location.leaseEnabled     ← true, for every location holding a lease
//   LocationType.allowsLeases ← true, for every type those locations are
//
// It only ever turns things ON, and only where a lease is the evidence. A
// location nobody has leased is left alone — deciding that a slip *should*
// be leasable is an admin's call, not a migration's. Do that in bulk from
// Admin → Location Types & Locations → Bulk edit.
//
// REQUIRES THE SCHEMA PUSH FIRST. Both fields must exist on the Instant app
// before anything can write them (instant.perms.ts denies attribute creation
// at runtime), so:
//
//   npx instant-cli@latest push schema
//   node scripts/migrate-leasable-flags.mjs          # dry run
//   node scripts/migrate-leasable-flags.mjs --apply  # write
//
// Safe to run twice: rows already flagged are skipped.

import { init } from "@instantdb/admin";
import { loadEnv } from "./env.mjs";

const env = loadEnv();
const appId = env.VITE_INSTANT_APP_ID;
const adminToken = env.INSTANT_APP_ADMIN_TOKEN;
if (!appId || !adminToken) {
  console.error("Need VITE_INSTANT_APP_ID and INSTANT_APP_ADMIN_TOKEN in .env.local.");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const db = init({ appId, adminToken });

const { locations } = await db.query({ locations: { leases: {}, type: {} } });

const leasedLocations = locations.filter((l) => (l.leases ?? []).length > 0);
const locationsToFlag = leasedLocations.filter((l) => !l.leaseEnabled);
const typesToFlag = [
  ...new Map(
    leasedLocations
      .map((l) => l.type)
      .filter((t) => t && !t.allowsLeases)
      .map((t) => [t.id, t]),
  ).values(),
];

console.log(apply ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");
console.log(`${leasedLocations.length} location(s) currently hold a lease.\n`);

console.log(`Location.leaseEnabled → true  (${locationsToFlag.length})`);
for (const l of locationsToFlag)
  console.log(`  - ${l.name}  [${l.type?.name ?? "no type"}]  ${(l.leases ?? []).length} lease(s)`);

console.log(`\nLocationType.allowsLeases → true  (${typesToFlag.length})`);
for (const t of typesToFlag) console.log(`  - ${t.name}`);

if (locationsToFlag.length === 0 && typesToFlag.length === 0) {
  console.log("\nNothing to do.");
} else if (apply) {
  await db.transact([
    ...locationsToFlag.map((l) => db.tx.locations[l.id].update({ leaseEnabled: true })),
    ...typesToFlag.map((t) => db.tx.locationTypes[t.id].update({ allowsLeases: true })),
  ]);
  console.log("\nWritten.");
} else {
  console.log("\nRe-run with --apply to write.");
}
