#!/usr/bin/env node
// One-off migration: checklistTemplateItems.type "gas_pump_check" → "lock_check".
//
// Lock Check shipped briefly as "gas_pump_check" before it was generalised
// past fuel pumps (a padlocked gate and a shed hasp are the same check). The
// app maps the old string on read, so nothing is broken without this — it
// just aligns stored data with the current name.
//
// Why a script rather than the template builder: the builder can only delete
// and re-add an item, which would break the templateItem link on every
// historical ChecklistItemResult that references these rows, silently
// orphaning completed checklist history. Only an in-place update of `type`
// preserves that, and nothing else about the rows changes.
//
// Safe to run twice: the second run finds nothing to do.
//
//   node scripts/migrate-gas-pump-to-lock-check.mjs          # dry run
//   node scripts/migrate-gas-pump-to-lock-check.mjs --apply  # write

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

const OLD = "gas_pump_check";
const NEW = "lock_check";

const data = await db.query({
  checklistTemplateItems: { $: { where: { type: OLD } } },
});
const items = data.checklistTemplateItems ?? [];

if (items.length === 0) {
  console.log(`Nothing to migrate — no items with type "${OLD}".`);
  process.exit(0);
}

console.log(`Found ${items.length} item(s) with type "${OLD}":`);
for (const i of items) {
  console.log(`  ${i.id}  order=${i.order}  ${i.label}`);
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to set type="${NEW}".`);
  process.exit(0);
}

// Only `type` is touched; label, order, config and every link are untouched,
// so the ChecklistItemResult rows pointing at these ids keep pointing at them.
await db.transact(items.map((i) => tx.checklistTemplateItems[i.id].update({ type: NEW })));

const after = await db.query({
  checklistTemplateItems: { $: { where: { type: OLD } } },
});
const left = (after.checklistTemplateItems ?? []).length;
console.log(`\nMigrated ${items.length} item(s) to "${NEW}". Remaining "${OLD}": ${left}.`);
