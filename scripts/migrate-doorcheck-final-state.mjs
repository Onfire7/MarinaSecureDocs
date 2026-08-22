#!/usr/bin/env node
// One-off migration: split a state check's single expected state into the
// pair the editor now asks for — Expected State (found) and Final State
// (left).
//
// The old config held one `expectedState` plus a `finalStateOnly` flag, so it
// could say "should be locked" or "only tell me how you left it", but never
// "expect it unlocked on arrival and locked when you leave" — which is what a
// door that's open by day and shut overnight actually needs.
//
// What this writes, per row:
//   finalState    ← the old expectedState (that value always described the
//                   state it should end up in, under both settings)
//   expectedState ← removed, i.e. Expected State becomes None
//   finalStateOnly← removed, superseded by an absent expectedState
//
// Expected State lands on None for every existing row deliberately: the old
// data cannot distinguish "found state genuinely expected to be X" from "X is
// just the resting state", and inventing a found-state expectation would
// start raising incidents nobody authored. Set them per item where they're
// wanted.
//
// The app reads unmigrated rows through a legacy fallback, so nothing breaks
// without this — it aligns stored data with the shape the editor writes.
//
// Safe to run twice: rows already carrying finalState are skipped.
//
//   node scripts/migrate-doorcheck-final-state.mjs          # dry run
//   node scripts/migrate-doorcheck-final-state.mjs --apply  # write

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

// gas_pump_check is the pre-rename lock check; the app still maps it on read.
const STATE_CHECK_TYPES = ["door_check", "lock_check", "gas_pump_check"];
const DEFAULT_STATE = "locked";

const { checklistTemplateItems: rows } = await db.query({
  checklistTemplateItems: {},
});

const todo = rows
  .filter((r) => STATE_CHECK_TYPES.includes(r.type))
  .filter((r) => (r.config ?? {}).finalState == null)
  .map((r) => {
    const cfg = r.config ?? {};
    // Everything except the two keys being replaced is carried over verbatim
    // — locationId in particular, which an incident needs to attach to.
    const { expectedState, finalStateOnly, ...rest } = cfg;
    return {
      id: r.id,
      label: r.label,
      from: `expectedState=${expectedState ?? "unset"}${finalStateOnly ? ", finalStateOnly" : ""}`,
      config: { ...rest, finalState: expectedState ?? DEFAULT_STATE },
    };
  });

console.log(apply ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");
for (const r of todo) {
  console.log(`  ${r.id}  "${r.label}"`);
  console.log(`    ${r.from}  →  finalState=${r.config.finalState}, Expected State=None`);
}
console.log(`\n${todo.length} of ${rows.length} template item(s) need migrating.`);

if (apply && todo.length > 0) {
  await db.transact(
    todo.map((r) => db.tx.checklistTemplateItems[r.id].update({ config: r.config })),
  );
  console.log("Written.");
}
