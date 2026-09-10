import {
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  UpdateType,
} from "@powersync/web";
import { POWERSYNC_URL } from "../config";
import { getClerkToken } from "../auth/clerkToken";
import { setSyncConfigError } from "../auth/syncStatus";
import { supabase } from "./supabase";

// The two halves of the connection to the marina's database.
//
// Down: PowerSync streams the rows this user's sync streams select into the
// device's SQLite. Up: local writes queue and drain to PostgREST. The app
// itself never does either — it reads and writes SQLite and nothing else.
//
// Both halves authenticate with the same Clerk JWT. PowerSync verifies it
// against Clerk's JWKS; Supabase accepts it as a third-party auth provider and
// evaluates RLS against its `sub`. Two independent configurations, one token —
// and either being wrong presents as an app with no data in it.

/**
 * Postgres error codes that will never succeed on retry, so a queued write
 * carrying one has to be dropped rather than retried forever.
 *
 * PowerSync's write queue is strictly ordered and drains from the front: an
 * operation that keeps failing blocks every write behind it, permanently. A
 * guard whose check-in violated a constraint would silently stop being able to
 * record anything at all, which is a far worse failure than losing the one bad
 * write.
 *
 *   22xxx  data exception — a value the column cannot hold
 *   23xxx  integrity violation — a constraint said no
 *   42501  insufficient privilege — RLS refused the write
 *
 * Everything else (network, 5xx, an expired token) is transient by
 * assumption, and retrying is right.
 */
const FATAL_RESPONSE_CODES = [/^22\d{3}$/, /^23\d{3}$/, /^42501$/];

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const token = await getClerkToken();
    if (!token) {
      // Signed out. Returning null stops PowerSync trying, rather than
      // hammering the service with anonymous requests it will reject.
      return null;
    }
    return { endpoint: POWERSYNC_URL!, token };
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    let lastOp: { op: UpdateType; table: string; id: string } | null = null;
    try {
      for (const op of transaction.crud) {
        lastOp = { op: op.op, table: op.table, id: op.id };
        const table = supabase.from(op.table);

        switch (op.op) {
          case UpdateType.PUT:
            // Upsert rather than insert: PowerSync replays the queue from the
            // start after a failed drain, so the same insert can arrive twice
            // after a flaky reconnect. The id is client-generated, so the
            // second one is the same row.
            await throwOnError(table.upsert({ ...op.opData, id: op.id }));
            break;
          case UpdateType.PATCH:
            await throwOnError(table.update(op.opData!).eq("id", op.id));
            break;
          case UpdateType.DELETE:
            await throwOnError(table.delete().eq("id", op.id));
            break;
        }
      }

      // Only now is the local queue cleared. Until this line, an interrupted
      // drain leaves everything queued and it is retried from the top.
      await transaction.complete();
      setSyncConfigError(null);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "";
      if (FATAL_RESPONSE_CODES.some((re) => re.test(code))) {
        console.error(
          `Discarding unretryable write to ${lastOp?.table} (${code})`,
          lastOp,
          error,
        );
        await transaction.complete();
        return;
      }
      throw error;
    }
  }
}

// PostgREST reports failures in the response body, not by rejecting. Without
// this, a refused write resolves successfully, the queue entry is cleared, and
// the change vanishes on the next sync with no error anywhere — the exact
// silent-failure shape that has cost this project days.
//
// One case it cannot catch: RLS refusing an UPDATE or DELETE is not an error
// at all. The row simply does not match the policy, so zero rows are affected
// and PostgREST returns 204. The write is dropped, PowerSync considers it
// delivered, and the next sync reverts the local row. That is a permissions
// bug presenting as a UI that quietly forgets — worth remembering before
// blaming React.
async function throwOnError<T extends { error: unknown }>(
  builder: PromiseLike<T>,
): Promise<void> {
  const { error } = await builder;
  if (error) throw error;
}
