#!/usr/bin/env node
// One-off: remove the test data an agent session left in the marina while
// verifying door/lock checks, deferred side effects, and the prompt fix.
//
// Every id below was traced back to the checklist that produced it, not
// guessed from timestamps — the marina was in real use during the same
// window, and two tickets plus one incident in that window are genuine and
// are deliberately NOT listed here:
//
//   ticket   69c8906e  "Backup camera doesn't work"          (07-26, real)
//   ticket   230d89c2  "Front turn signals ... intermittent" (07-26, real)
//   incident 957df944  "Parlor Room - Front Door found unlocked"
//                      raised by checklist c2cbf436, which a real user
//                      completed at 01:41 — not an agent run.
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
  {
    ns: "incidents",
    rows: [
      ["e96e4037-75da-4e0b-9741-d6f2d18a32cd", "door-check verify run, 00:41 (attached to Basketball Court — an arbitrary target picked by the test)"],
      ["751719d3-419f-46c8-8d92-7130d690fe05", "door-check verify run, 00:41 (same)"],
      ["5b8d1c56-0d9f-4583-878d-54f90a583c70", "deferred-effects verify run, 01:06 (checklist b6aedffb)"],
      ["f4eb2ed1-4ed5-491c-a2c6-7b1c4d888e08", "deferred-effects verify run, 01:06 (checklist b6aedffb)"],
    ],
  },
  {
    ns: "tickets",
    rows: [
      ["2f30ee26-bdde-472e-b0dd-bea3a3b42438", "raised by the 00:41 verify run"],
      ["751b7c95-97c4-42fc-842c-95422b0a7143", "raised by the 01:06 verify run"],
    ],
  },
  {
    ns: "checklistTemplateItems",
    rows: [
      ["f58dbcb2-8d30-4d03-9d0a-6b729a0cc8b4", '"Fuel Dock Padlock" — added to the Resturaunt template by the prompt-fix verify run'],
    ],
  },
  {
    ns: "checklistItemResults",
    rows: [
      ["31668bb1-9b2e-4050-aaa6-87cfc65f7604", "orphaned result for the deleted 'Fuel Dock Pump 1' test item"],
      ["ce0a486a-44d3-44cd-9dc0-88c7dbb85d75", "Pump #1 result from the lock-check verify scan (checklist 3bd508bc)"],
    ],
  },
  {
    // Test scans, identified by the fake geolocation every verify script
    // injected — (40, -74), which is nowhere near this marina's real
    // coordinates (~33.85, -96.64). That signal matters: check-in 6ff2a793
    // looked like an agent row by timestamp and even surfaced in a verify
    // script's output, but carries real marina GPS — the dedupe window had
    // resumed a check-in a real user had just made, rather than creating
    // one. Deleting by timestamp would have taken it.
    ns: "checkIns",
    rows: [
      ["ed515f2e-5632-45ad-a19c-5d903bfb3316", "agent verify scan 07-27 21:52 — Maintenance Shop Gate"],
      ["5f2f1a7f-8e71-4c61-94e8-4098737e489a", "agent verify scan 07-27 23:38 — Maintenance Shop Gate"],
      ["c441a64b-873d-4e27-b8e8-dfff8a292210", "agent verify scan 07-27 23:39 — Main Pavilion"],
      ["c860ca88-f1aa-4fcd-a5fc-50ca47b52fde", "agent verify scan 07-27 23:39 — Water Storage #2 - Pavilion"],
      ["fc7b0160-2355-4c9d-818a-5e44877d2e8b", "agent verify scan 07-27 23:39 — The Point - Back Door"],
      ["f50022a5-5478-4da0-90f3-fcc20e339d15", "agent verify scan 07-27 23:39 — Burrage Condo"],
      ["3c709f76-f8be-4415-8159-d190e29997ac", "agent verify scan 07-27 23:43 — Maintenance Shop Gate"],
      ["70b5971a-ad3b-423b-8f16-e7fa5d13caba", "agent verify scan 07-27 23:47 — Main Pavilion"],
      ["3ba1133c-ca38-4483-8006-9814b9d98112", "agent verify scan 07-27 23:47 — Water Storage #2 - Pavilion"],
      ["5ad6e734-b927-4014-97bc-2c074e71848f", "agent verify scan 07-27 23:47 — The Point - Back Door"],
      ["df408f1b-97a0-4c21-a6c1-40c9c7cda03b", "agent verify scan 07-27 23:47 — Burrage Condo"],
      ["eecc3db6-fa1a-4a3d-99c2-7e46985ec353", "agent verify scan 07-28 01:48 — Walkway"],
    ],
  },
  {
    ns: "checklists",
    rows: [
      ["3bd508bc-d37c-4c40-8000-000000000000", "in-progress Fuel Dock instance created by the lock-check verify scan"],
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
