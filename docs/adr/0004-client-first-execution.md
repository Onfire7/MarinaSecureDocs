# Work runs client-side unless it provably cannot

> **Amended by [ADR 0005](0005-supabase-and-powersync-replace-instantdb.md).**
> The premise below — "a static frontend
> over a local-first database has no server to lean on" — weakens under
> Supabase, which brings Edge Functions and `pg_cron`. The conclusion
> survives and the bar stays high. One consequence inverts: the Activity Log
> retention purge, cited here as the case proving the criterion has teeth,
> becomes a scheduled SQL statement rather than a Netlify Function. It is
> still work no client may do; it simply no longer needs infrastructure.

Server-side execution is reserved for work needing one of three things: a
credential that must never reach the browser, authority the permission rules
deliberately deny every client, or execution when no client is present at all.
Everything else runs in the client.

A static frontend over a local-first database has no server to lean on, so
each server-side dependency is infrastructure to deploy, monitor and pay for
in every marina's own account. The bar is set deliberately high.

## Consequences

The interesting outcomes are the ones that read as surprising:

- **Recurring checklists are generated client-side**, by the first holder of
  the assigned role to open the app on a matching day, using a deterministic
  id so racing clients converge on one row instead of duplicating. An earlier
  design specified a scheduled function for this; it was replaced, and the
  documentation that still described it was a live contradiction for months.
- **Time-based maintenance rules move client-side too.** "Every 90 days since
  last completed" needs no credential and no denied authority — only for
  someone to evaluate it eventually. The cost is that a rule fires late if
  nobody opens the app for a week, which is the same tradeoff already accepted
  for recurring checklists.
- **The Activity Log retention purge cannot follow.** The rules set
  `delete: "false"` on `activityLogEntries` for every client, so no client can
  execute it whatever the preference. It is the case that proves the criterion
  has teeth rather than being a slogan.

"Nothing runs in the background" is therefore close to true, and where it
isn't, the reason is nameable in one of the three clauses above.
