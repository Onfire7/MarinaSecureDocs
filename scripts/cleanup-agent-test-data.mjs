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
  // CheckpointScanModal verify runs against "The Point - Back Door" checkpoint
  // (checkin-navigation regression check, then the inline-checklist-items
  // feature, which was completed end to end), 2026-07-30.
  {
    ns: "checklistItemResults",
    rows: [
      ["6bd8b2b1-5fa8-4e07-a48d-47aa3764719b", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["3d6f2e1f-730a-4071-9590-fc1ba4b35ba2", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["cd6854f4-5ec5-4466-a468-cb9285acd5b6", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["0b46e63d-d396-47f5-b183-dd435518dd6e", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["b8b75aaa-bd77-4ec6-97a3-51c12915e598", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["67318e56-bd9a-4d70-9eee-d0cc6616faf5", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["90c4b041-de39-4a4e-98b9-0a2dbb63cf76", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["92841bdb-2b09-44e5-9485-bc4286a7f35b", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["9dfdcef5-8506-4b69-8467-30c9ee2aec8a", "door_check result from the inline-items verify run (checklist 39fb2801)"],
      ["bf0933bc-ec86-4854-9373-ada57311e0f2", "door_check result from the inline-items verify run (checklist 39fb2801)"],
    ],
  },
  {
    ns: "checklists",
    rows: [
      ["2234e404-46f3-4f78-8000-000000000000", "left in_progress, no items answered — checkin-navigation regression check"],
      ["39fb2801-7da5-4829-8000-000000000000", "completed end to end verifying inline checklist items in the scan modal"],
    ],
  },
  {
    ns: "checkIns",
    rows: [
      ["d71d74ee-c41f-4a8e-9eee-100995d45eec", "triggered checklist 2234e404"],
      ["69b184f8-bd6d-4dc1-bf63-2b6fff015375", "triggered checklist 39fb2801"],
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
