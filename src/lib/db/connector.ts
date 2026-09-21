import {
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  UpdateType,
} from "@powersync/web";
import { POWERSYNC_URL } from "../config";
import { getClerkToken } from "../auth/clerkToken";
import { setSyncConfigError } from "../auth/syncStatus";
import { recordRejectedWrite } from "./rejectedWrites";
import { STRUCTURED_COLUMNS } from "./schema";
import { supabase } from "./supabase";
import { toUploadRow } from "./uploadShape";

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
 *
 * None of these codes counts when the response was a 401. A 401 means the
 * request arrived without a usable identity, and Postgres then refuses it
 * with the very same 42501 it gives a user who genuinely lacks the privilege.
 * Treating that as permanent deleted a night's checklist answers: checks made
 * in a dead spot were uploaded as nobody, refused, discarded, and then erased
 * from the phone by the next sync. "Who are you?" is never a reason to throw
 * a write away; "you may not" is.
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

    // Never send a write as nobody. Clerk's getToken() returns null once a
    // device has been offline longer than the token's 60-second life, and it
    // can stay null for a moment after the network returns — exactly when
    // PowerSync starts draining the queue. The Supabase client would send the
    // request anyway, without an identity. Throwing leaves everything queued
    // and PowerSync retries, by which time Clerk has a token again.
    if (!(await getClerkToken())) {
      throw new Error("No Clerk session token yet; upload deferred.");
    }

    let lastOp: { op: UpdateType; table: string; id: string } | null = null;
    try {
      for (const op of transaction.crud) {
        lastOp = { op: op.op, table: op.table, id: op.id };
        const table = supabase.from(op.table);
        // jsonb and array columns are text on the device and must not be
        // uploaded as text — see uploadShape.ts.
        const data = toUploadRow(op.table, op.opData, STRUCTURED_COLUMNS);

        switch (op.op) {
          case UpdateType.PUT:
            // Upsert rather than insert: PowerSync replays the queue from the
            // start after a failed drain, so the same insert can arrive twice
            // after a flaky reconnect. The id is client-generated, so the
            // second one is the same row.
            await throwOnError(table.upsert({ ...data, id: op.id }));
            break;
          case UpdateType.PATCH:
            await throwOnError(table.update(data).eq("id", op.id));
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
      const { code = "", status } = (error ?? {}) as UploadError;
      if (status !== 401 && FATAL_RESPONSE_CODES.some((re) => re.test(code))) {
        console.error(
          `Discarding unretryable write to ${lastOp?.table} (${code})`,
          lastOp,
          error,
        );
        // Discarding is right; discarding silently is how work vanishes with
        // nobody the wiser. The save indicator shows this until dismissed.
        recordRejectedWrite({
          table: lastOp?.table ?? "unknown",
          op: lastOp?.op ?? "unknown",
          code,
          message: (error as { message?: string } | null)?.message ?? "",
        });
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
//
// The HTTP status rides along on the thrown error, because the Postgres code
// alone cannot tell an unauthenticated request from a refused one.
interface UploadError {
  code?: string;
  status?: number;
}

async function throwOnError<T extends { error: unknown; status?: number }>(
  builder: PromiseLike<T>,
): Promise<void> {
  const { error, status } = await builder;
  if (error) throw Object.assign(error as object, { status });
}
