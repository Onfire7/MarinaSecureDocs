# Schema migrations run live, not behind a maintenance window

InstantDB is local-first and the app is an installable PWA with a
prompt-to-update service worker, so there is no moment at which every client
is running the current bundle. Rather than pretend otherwise, migrations make
both the old and new shapes valid at once: expand the schema, dual-write and
backport, sweep every row server-side from the deploy pipeline, converge the
stale writes that arrive afterward, and only then contract.

## Considered options

**A blocking maintenance window** — flip a flag, kick every client out, migrate,
let them back in. Rejected for two reasons. It doesn't work: a data flag gates
the UI but not writes, since local-first clients sync queued transactions on
reconnect and InstantDB's permission rules have no way to read a global
singleton, so genuinely blocking writes means pushing a restrictive rule set
and restoring it afterward — two extra failure points, one of which locks a
24/7 security operation out of its own system if the deploy dies midway. And
it's disproportionate: with additive-only changes, the overwhelming majority
of releases add attributes nothing reads yet, and there is nothing to protect
against.

A short window is still used for the sweep itself on migrations that actually
backfill data, so nobody reads a half-migrated database. Additive-only
releases skip it entirely.

## Consequences

- **Deletion is gated on completeness, not just time.** A 30-day floor, plus a
  query proving no row still holds the old shape. Time alone would delete data
  belonging to rows nothing had touched.
- **Rollback never reverts the schema.** Pushing an older schema *deletes* the
  attributes it no longer mentions, along with their data. To undo a
  migration, stop it and revert the client bundle; the added attributes are
  harmless where they sit.
- **Not every migration can backport.** A widened enum, a split field, or a
  genuinely new concept has no old-shape equivalent. Those are marked
  non-backportable and do force clients to update — an old bundle silently
  misreading a value is worse than being blocked.
- **A client offline past the deletion floor loses its queued writes.** Its
  transactions target attributes that no longer exist, runtime attribute
  creation is denied, and the writes are rejected. Accepted as out of
  contract, and recorded because the failure is silent.
