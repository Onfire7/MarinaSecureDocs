#!/usr/bin/env node
// Generates src/lib/db/schema.ts — the PowerSync client schema — from the
// local Postgres.
//
// Hand-maintaining 62 tables against a moving migration set is a losing game,
// and the failure mode is quiet: a column missing from the client schema is
// not an error, it is a column that reads `undefined` forever. So the schema
// is derived, and `pnpm run schema:check` fails if the committed file has
// drifted from the database.
//
// Usage:  node scripts/generate-client-schema.mjs [--check]

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import pg from "pg";

const OUT = new URL("../src/lib/db/schema.ts", import.meta.url);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// PowerSync's local store is SQLite, which has three column types worth
// having. Everything below collapses into one of them.
//
//   text     uuid, text, enums, timestamptz, jsonb, and Postgres arrays
//            (which arrive JSON-encoded — roles.allow is a string, not a
//            string[], and the data layer parses it)
//   integer  integer, bigint, boolean (0/1 — SQLite has no boolean)
//   real     numeric, double precision
//
// numeric → real deserves a note, because reservations.rate/deposit/balance
// are money. A double holds any cent value exactly below 2^53 cents, and
// Postgres's float8 output is shortest-round-trip, so a value written from
// the client casts back to the same numeric. The precision that a decimal
// type buys you is in *accumulation*, and no accumulation happens here — the
// database is still the one holding numeric.
function sqliteType(dataType) {
  switch (dataType) {
    case "integer":
    case "bigint":
    case "smallint":
    case "boolean":
      return "integer";
    case "numeric":
    case "double precision":
    case "real":
      return "real";
    default:
      return "text";
  }
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

const { rows: columns } = await client.query(`
  select c.relname as table_name, a.attname as column_name,
         format_type(a.atttypid, null) as pg_type,
         case when t.typtype = 'e' then 'enum'
              when t.typcategory = 'A' then 'array'
              else format_type(a.atttypid, null) end as kind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_type t on t.oid = a.atttypid
   where n.nspname = 'public' and c.relkind = 'r'
   order by c.relname, a.attnum
`);

// Local indexes come from the foreign keys, because the queries the data layer
// writes are overwhelmingly "the children of this row" — a checklist's items,
// a boat's owners, a contact's leases. Postgres indexes its primary keys and
// nothing else automatically; SQLite is the same, and 8,401 contacts is enough
// for the difference to be visible on a phone.
const { rows: fks } = await client.query(`
  select c.relname as table_name, a.attname as column_name
    from pg_constraint pc
    join pg_class c on c.oid = pc.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = pc.conkey[1]
   where n.nspname = 'public' and pc.contype = 'f' and array_length(pc.conkey, 1) = 1
   order by 1, 2
`);

// Single-column unique constraints are lookups by definition — a checkpoint's
// guid_url is how an NFC scan finds it, and it is the whole point of the scan
// working offline.
const { rows: uniques } = await client.query(`
  select c.relname as table_name, a.attname as column_name
    from pg_constraint pc
    join pg_class c on c.oid = pc.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = pc.conkey[1]
   where n.nspname = 'public' and pc.contype = 'u' and array_length(pc.conkey, 1) = 1
     and a.attname <> 'id'
   order by 1, 2
`);

await client.end();

const byTable = new Map();
for (const row of columns) {
  if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
  byTable.get(row.table_name).push(row);
}

const indexesByTable = new Map();
for (const row of [...fks, ...uniques]) {
  if (!indexesByTable.has(row.table_name)) indexesByTable.set(row.table_name, new Set());
  indexesByTable.get(row.table_name).add(row.column_name);
}

const tableNames = [...byTable.keys()].sort();

const parts = [];
parts.push(`// GENERATED FILE — do not edit.
//
// Produced by \`node scripts/generate-client-schema.mjs\` from the local
// Supabase database; \`pnpm run schema:check\` fails when it drifts. To change
// anything here, write a migration and regenerate.
//
// This is the shape of the device's own SQLite database — the one every query
// in src/data/ runs against, online or off. It is not a description of
// Postgres: booleans are 0/1, timestamps and jsonb and arrays are all text,
// and \`id\` is implicit on every table because that is how PowerSync keys a
// row. What arrives in these tables is decided by powersync/config/sync-config.yaml,
// not by this file — a table present here with no matching sync stream is
// simply always empty.
import { column, Schema, Table } from "@powersync/web";
`);

for (const name of tableNames) {
  const cols = byTable
    .get(name)
    .filter((c) => c.column_name !== "id")
    .map((c) => {
      const t = sqliteType(c.pg_type);
      const note = c.kind === "array" ? " // JSON-encoded" : "";
      return `    ${c.column_name}: column.${t},${note}`;
    });
  const idx = [...(indexesByTable.get(name) ?? [])].sort();
  const indexBlock = idx.length
    ? `,\n  {\n    indexes: {\n${idx
        .map((c) => `      by_${c}: ["${c}"],`)
        .join("\n")}\n    },\n  }`
    : "";
  parts.push(
    `const ${name} = new Table(\n  {\n${cols.join("\n")}\n  }${indexBlock},\n);\n`,
  );
}

parts.push(`export const AppSchema = new Schema({
${tableNames.map((n) => `  ${n},`).join("\n")}
});

/** Row types for every synced table, keyed by table name. */
export type Database = (typeof AppSchema)["types"];

/** Every table the device can hold, for the upload connector's sanity checks. */
export const TABLE_NAMES = [
${tableNames.map((n) => `  "${n}",`).join("\n")}
] as const;
`);

const generated = parts.join("\n");

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== generated) {
    console.error(
      "src/lib/db/schema.ts is out of date with the database.\n" +
        "Run: node scripts/generate-client-schema.mjs",
    );
    process.exit(1);
  }
  console.log(`schema.ts matches the database (${tableNames.length} tables)`);
} else {
  writeFileSync(OUT, generated);
  console.log(
    `wrote src/lib/db/schema.ts — ${tableNames.length} tables, ` +
      `${columns.length - tableNames.length} columns`,
  );
}
