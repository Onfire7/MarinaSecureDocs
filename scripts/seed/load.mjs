// The load half of export -> transform -> load. Talks to Postgres; contains no
// mapping logic, so the transform stays testable without a database.

const BATCH = 500;

function insertSql(table, rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const params = [];
  const tuples = rows.map((r) => {
    const slots = cols.map((c) => {
      params.push(r[c] === undefined ? null : r[c]);
      return `$${params.length}`;
    });
    return `(${slots.join(",")})`;
  });
  return {
    text: `insert into ${table} (${cols.map((c) => `"${c}"`).join(",")}) values ${tuples.join(",")} on conflict do nothing`,
    values: params,
  };
}

export async function loadAll(client, { tables, deferred }, order, log = () => {}) {
  const counts = {};
  for (const table of order) {
    const rows = tables[table] ?? [];
    if (!rows.length) continue;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { text, values } = insertSql(table, chunk);
      const res = await client.query(text, values);
      done += res.rowCount ?? chunk.length;
    }
    counts[table] = done;
    log(`  ${String(done).padStart(6)}  ${table}`);
  }

  // Self-referential foreign keys, applied once every row of the table exists.
  // Grouped per table so a location's parent and an item's previous version
  // are each one statement rather than 546.
  // Grouped by table AND column: a synthetic location defers parent_id,
  // current_boat_id and current_vehicle_id independently, so keying on table
  // alone would apply one column's values under another column's name.
  const byTarget = new Map();
  for (const d of deferred) {
    for (const [col, target] of Object.entries(d.set)) {
      const key = `${d.table}.${col}`;
      if (!byTarget.has(key)) byTarget.set(key, { table: d.table, col, items: [] });
      byTarget.get(key).items.push({ id: d.id, target });
    }
  }
  for (const { table, col, items } of byTarget.values()) {
    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      const values = [];
      const pairs = chunk.map((d) => {
        values.push(d.id, d.target);
        return `($${values.length - 1}::uuid, $${values.length}::uuid)`;
      });
      await client.query(
        `update ${table} t set "${col}" = v.target
           from (values ${pairs.join(",")}) as v(id, target)
          where t.id = v.id`,
        values,
      );
    }
    log(`  ${String(items.length).padStart(6)}  ${table}.${col} (deferred)`);
  }
  return counts;
}
