# Ticket and Incident history is written by the app, not by a trigger

Tickets and Incidents get a permanent history (Ticket Updates, Incident
Updates) because the Shift Report shows what changed after a guard handed
it in, and the Activity Log cannot serve: retention purges it. Each history
row is written by the client, in the same transaction as the change it
records, through the one function in `src/data/` that changes that record.

The alternative was a Postgres trigger on `tickets` and `incidents`. Nothing
could bypass it, which is its whole appeal. Rejected because a trigger runs
when the change *uploads*, not when it was made: an edit made offline at
3 AM and synced at 8 AM would be recorded as 8 AM, and the history's job is
to say when things happened. A trigger also cannot see who made the change
without an extra "last edited by" column that every write must remember to
set, which is the same discipline in a worse place. This follows ADR 0004
(client-first execution).

**Consequences.** The guarantee that nothing bypasses the history moves from
the database to the code: a test asserts that no module other than the
owning data module writes to `tickets` or `incidents`. History rows are
insert-only, enforced by RLS. Existing Ticket and Incident data was not in
production use and is not backfilled.
