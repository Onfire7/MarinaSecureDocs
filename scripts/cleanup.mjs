#!/usr/bin/env node
// Recurring data cleanups, run on demand.
//
//   node scripts/cleanup.mjs                        # dry run, every cleanup
//   node scripts/cleanup.mjs --apply                # delete
//   node scripts/cleanup.mjs --only orphaned-template-items
//   node scripts/cleanup.mjs --list
//
// Dry run is the default on purpose: every cleanup here deletes rows from
// the live marina, and the plan is worth reading before it runs. Each one is
// idempotent — a second pass finds nothing left to do.
//
// Distinct from cleanup-agent-test-data.mjs, which is a frozen list of
// specific ids from one session. These are *rules*: they describe a shape of
// row that shouldn't exist, so they stay useful as the data changes.
//
// ---------------------------------------------------------------------
// Adding a cleanup
//
// Push an entry onto CLEANUPS with:
//   name         kebab-case, what it removes
//   description  one line, shown by --list and at the top of a run
//   ns           namespace the rows are deleted from
//   find(db)     async, returns the rows to delete — each needs an `id`
//                and a `why` explaining, per row, what made it garbage
//
// A cleanup that can't tell garbage from data belongs nowhere near this
// file. When in doubt, make find() stricter and leave rows behind.
// ---------------------------------------------------------------------

import { init } from "@instantdb/admin";
import { loadEnv } from "./env.mjs";

const CLEANUPS = [
  {
    name: "orphaned-template-items",
    description:
      "Checklist template items detached from every section and read by no instance.",
    ns: "checklistTemplateItems",
    // Template items are copy-on-edit: editing one writes a replacement and
    // detaches the original, which has to stay only while some instance item
    // still renders through it. A row with neither a section nor an instance
    // is a superseded draft that nothing — no query, no checklist, no report
    // — can reach again. Both conditions matter: a detached row WITH
    // instances is load-bearing history, and a row still linked to a section
    // is live.
    async find(client) {
      const { checklistTemplateItems: rows } = await client.query({
        checklistTemplateItems: { section: {}, instances: {} },
      });
      return rows
        .filter((r) => !r.section && (r.instances ?? []).length === 0)
        .map((r) => ({
          id: r.id,
          why: `"${r.label}" v${r.version ?? 1} (${r.type}) — no section, no instances`,
        }));
    },
  },
];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

// Before the credential check: listing what exists reads nothing.
if (args.includes("--list")) {
  for (const c of CLEANUPS) console.log(`${c.name}\n  ${c.description}\n`);
  process.exit(0);
}

const env = loadEnv();
const appId = env.VITE_INSTANT_APP_ID;
const adminToken = env.INSTANT_APP_ADMIN_TOKEN;
if (!appId || !adminToken) {
  console.error("Need VITE_INSTANT_APP_ID and INSTANT_APP_ADMIN_TOKEN in .env.local.");
  process.exit(1);
}

const db = init({ appId, adminToken });

const selected = only ? CLEANUPS.filter((c) => c.name === only) : CLEANUPS;
if (selected.length === 0) {
  console.error(`No cleanup named "${only}". Try --list.`);
  process.exit(1);
}

console.log(apply ? "APPLYING\n" : "DRY RUN — pass --apply to delete\n");

let grandTotal = 0;
for (const cleanup of selected) {
  console.log(`── ${cleanup.name}`);
  console.log(`   ${cleanup.description}`);
  const found = await cleanup.find(db);
  if (found.length === 0) {
    console.log("   nothing to do\n");
    continue;
  }
  // The whole list, not a sample: an unreviewable plan is not a plan.
  for (const row of found) console.log(`   - ${row.id}  ${row.why}`);
  console.log(`   ${found.length} row(s) in ${cleanup.ns}`);
  if (apply) {
    await db.transact(found.map((row) => db.tx[cleanup.ns][row.id].delete()));
    console.log("   deleted");
  }
  grandTotal += found.length;
  console.log("");
}

console.log(
  apply
    ? `Done — ${grandTotal} row(s) deleted.`
    : `Done — ${grandTotal} row(s) would be deleted. Re-run with --apply.`,
);
