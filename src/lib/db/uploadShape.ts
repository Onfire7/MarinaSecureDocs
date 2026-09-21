// The shape a queued write must have before it is sent to Postgres.
//
// SQLite on the device has three column types, so jsonb and Postgres arrays
// are held there as TEXT — the data layer JSON.stringify()s them on the way
// in. They cannot go UP as text. PostgREST hands a JSON string to a jsonb
// column as exactly that, a string, and Postgres stores `"{\"type\":…}"`; an
// array column refuses the text outright (22P02), which the connector treats
// as unretryable and discards.
//
// Nothing failed when this was wrong, which is why it lasted: the device kept
// its own correct copy until the row synced back, and only then did an answer
// stop being an object. Checklist submit reads answers to decide what else to
// record, so mileage readings, and the incidents and tickets a failed door
// check raises, silently stopped being created.
//
// Which columns are structured comes from Postgres itself, via the schema
// generator — STRUCTURED_COLUMNS in schema.ts — not from a list kept by hand.

export type StructuredColumns = Readonly<Record<string, readonly string[]>>;

export function toUploadRow(
  table: string,
  opData: Record<string, unknown> | undefined,
  structured: StructuredColumns,
): Record<string, unknown> {
  const data = opData ?? {};
  const columns = structured[table];
  if (!columns?.length) return data;

  const out: Record<string, unknown> = { ...data };
  for (const column of columns) {
    out[column] = parseStructured(out[column]);
  }
  return out;
}

function parseStructured(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    // Already double-encoded on the device: unwrap it rather than upload the
    // damage a second time.
    return typeof parsed === "string" ? parseStructured(parsed) : parsed;
  } catch {
    // Not ours to fail on. Throwing would wedge the whole queue behind one
    // bad value; Postgres can refuse it, and that refusal is recorded.
    return value;
  }
}
