#!/usr/bin/env node
// One-off: remove test data an agent session left in the marina while
// verifying a change against the live beta database.
//
//   node scripts/cleanup-agent-test-data.mjs          # dry run
//   node scripts/cleanup-agent-test-data.mjs --apply  # delete
//
// Idempotent: already-deleted rows simply aren't found on a second run.

import { init, tx } from "@instantdb/admin";
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

// Full ids, grouped by namespace, each with the run that created it.
const PLAN = [
  // Asset location / gallons meter type verify run, 2026-07-29 ~04:26.
  {
    ns: "activityLogEntries",
    rows: [
      ["118599d7-cdeb-4f15-a680-755c5283f6bc", "meter-updated log entry for the gallons verify asset"],
    ],
  },
  {
    ns: "assetMeterReadings",
    rows: [
      ["d3830375-c721-4956-b480-5972f9e93bd7", "500 gal test reading on the gallons verify asset"],
    ],
  },
  {
    ns: "assets",
    rows: [
      ["a6a362a5-8a6c-4164-b962-c848c106dc04", "\"Diesel Tank Test\" — created to verify the gallons meter type option"],
    ],
  },
  // assetLocation link write-path verify run, right after the schema push,
  // 2026-07-29 ~04:31.
  {
    ns: "activityLogEntries",
    rows: [
      ["6e24e2e0-956a-4785-9a56-02491cb4e796", "location-changed log entry for the location-link verify asset"],
    ],
  },
  {
    ns: "assets",
    rows: [
      ["2697600a-2744-4206-b7be-3c4ed290273f", "\"Location Link Test\" — created to verify the new assets.location link post-schema-push"],
    ],
  },
];

// Resolve every id against live data first, so a stale/typo'd id is reported
// rather than silently deleting nothing (or worse, the wrong thing).
let found = 0;
let missing = 0;
const toDelete = [];

for (const { ns, rows } of PLAN) {
  const res = await db.query({ [ns]: {} });
  const byId = new Map((res[ns] ?? []).map((r) => [r.id, r]));
  for (const [id, why] of rows) {
    const row = byId.get(id);
    if (!row) {
      console.log(`  MISSING  ${ns.padEnd(24)} ${id}  (${why})`);
      missing++;
      continue;
    }
    const label = row.title ?? row.label ?? row.status ?? "";
    console.log(`  delete   ${ns.padEnd(24)} ${id}  ${String(label).slice(0, 40)}`);
    console.log(`           ↳ ${why}`);
    toDelete.push(tx[ns][id].delete());
    found++;
  }
}

console.log(`\n${found} row(s) to delete, ${missing} not found.`);

if (!apply) {
  console.log("Dry run. Re-run with --apply to delete.");
  process.exit(0);
}
if (toDelete.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

await db.transact(toDelete);
console.log(`Deleted ${toDelete.length} row(s).`);
