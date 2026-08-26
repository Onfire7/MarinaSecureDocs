#!/usr/bin/env node
// Seed a Postgres database from the InstantDB export, plus synthetic
// occupancy data the export does not contain.
//
// The export carries this marina's real CONFIGURATION — 547 locations, 57
// checkpoints, the checklist template tree, roles, settings — and almost no
// operational data: 0 boats, 0 leases, 1 contact. Sync-stream scoping is
// defined in terms of occupancy (docs/architecture.md), so it has nothing to
// bite on without the synthetic half.
//
//   node scripts/seed/index.mjs                 # local stack
//   node scripts/seed/index.mjs --config-only   # skip synthetic data
//   node scripts/seed/index.mjs --reset         # truncate first
//
// Deliberately local-only: it takes a connection string rather than reading a
// remote one, so seeding production is something you have to mean.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { transform, LOAD_ORDER } from "./transform.mjs";
import { loadAll } from "./load.mjs";
import { generateOccupancy } from "./synthetic.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const EXPORT_DIR = `${root}migration/instant-export`;
const CONN = process.env.SEED_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const configOnly = process.argv.includes("--config-only");
const doReset = process.argv.includes("--reset");

function readExport() {
  const ex = {};
  for (const f of readdirSync(EXPORT_DIR)) {
    if (f.startsWith("_") || !f.endsWith(".json")) continue;
    ex[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(`${EXPORT_DIR}/${f}`, "utf8"));
  }
  return ex;
}

const client = new pg.Client({ connectionString: CONN });
await client.connect();
console.log(`seeding ${CONN.replace(/:[^:@]+@/, ":***@")}\n`);

if (doReset) {
  const { rows } = await client.query(
    `select tablename from pg_tables where schemaname='public'`);
  await client.query(
    `truncate ${rows.map((r) => `public."${r.tablename}"`).join(", ")} cascade`);
  console.log(`truncated ${rows.length} tables\n`);
}

await client.query("begin");
try {
  console.log("── real configuration, via the migration transform ──");
  const { tables, deferred, dropped } = transform(readExport());
  const counts = await loadAll(client, { tables, deferred }, LOAD_ORDER, console.log);
  const configRows = Object.values(counts).reduce((s, n) => s + n, 0);

  // Dropped rows are reported, never silent. A row that vanishes without a
  // line of output is indistinguishable from a transform bug.
  if (dropped.length) {
    console.log(`\n  dropped ${dropped.length} row(s) the new schema rejects:`);
    for (const d of dropped) console.log(`    - ${d.table}: "${d.title}" — ${d.reason}`);
  }

  let synthRows = 0;
  if (!configOnly) {
    console.log("\n── synthetic occupancy ──");
    const synth = generateOccupancy(tables);
    synthRows = Object.values(synth.tables).reduce((s, r) => s + r.length, 0);
    await loadAll(client, synth, LOAD_ORDER, console.log);
  }

  await client.query("commit");
  console.log(`\n✓ ${configRows} config rows + ${synthRows} synthetic rows`);
} catch (e) {
  await client.query("rollback");
  console.error("\n✗ rolled back:", e.message);
  if (e.detail) console.error("  detail:", e.detail);
  process.exitCode = 1;
} finally {
  await client.end();
}
