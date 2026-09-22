# Local PowerSync

A self-hosted PowerSync (Open Edition) service replicating from the **local**
Supabase stack, so sync rules can be developed and broken without touching a
marina's real database.

Without this, testing a stream would mean pushing seed data to production —
PowerSync Cloud replicates from the remote Postgres, not from your laptop.

```bash
supabase start          # the app database must be up first
pnpm run ps:up          # start PowerSync + its bucket storage
pnpm run ps:logs        # follow replication
pnpm run ps:down        # stop
pnpm run ps:reset       # stop, DESTROY bucket storage, start clean
```

Health: `curl http://127.0.0.1:8080/probes/liveness` → `200`.

## How it fits together

| Piece | Where |
|---|---|
| App database | Supabase local, `127.0.0.1:54322` |
| Replication role | `powersync_role`, created by `supabase/seed.sql` on every `db reset` |
| Publication | `powersync`, created by migration `20260826001800` |
| Bucket storage | its own Postgres container — *not* the app database |
| Client auth | Clerk's JWKS, the same issuer Supabase trusts |
| Sync rules | `config/sync-config.yaml` |

Bucket storage is deliberately separate from the app database so
`supabase db reset` cannot corrupt sync state as a side effect, and so wiping
that state is a deliberate act (`ps:reset`).

## After `supabase db reset`

The reset recreates the database, which invalidates PowerSync's replication
slot. Run `pnpm run ps:reset` afterwards, or replication will sit against a
slot that no longer means anything.

## Podman

`docker` here is a podman shim, and three things differ:

- **The API socket must be running.** `systemctl --user start podman.socket`.
  `docker info` succeeds without it (the CLI does not need the socket) but the
  Supabase CLI and compose do — the symptom is
  `statfs /run/user/1000/podman/podman.sock: no such file or directory`.
- **Image names must be fully qualified.** `docker.io/postgres:17`, not
  `postgres:17`. Podman has no short-name resolution without a
  `containers-registries.conf`.
- **`default` must be declared** in the `networks:` block once any other
  network is present, or compose fails with `missing networks: default`.

## Sync rules status

Only the **always resident** tier is implemented — marina configuration. The
occupancy and age tiers described in
[docs/architecture.md](../docs/architecture.md) are the next task, and are the
ones with real design in them.
