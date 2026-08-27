import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { PowerSyncContext } from "@powersync/react";
import { db } from ".";
import { SupabaseConnector } from "./connector";
import { setClerkTokenSource } from "../auth/clerkToken";
import { setSyncAuthError } from "../auth/syncAuthStatus";

/**
 * Connects the device's database to the marina's, and keeps that connection
 * pointed at whoever is currently signed in.
 *
 * The re-run on `sessionId` is the shared-device User Switch: Clerk swaps the
 * active session without unmounting anything, and this reconnects so PowerSync
 * recomputes which streams apply. A guard who hands the phone to someone
 * without `view_incidents` sees the incident buckets removed at the next
 * checkpoint — that removal is what makes the permission boundary hold on the
 * device rather than only in a query.
 */
export function PowerSyncProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, sessionId, getToken } = useAuth();

  // One connector for the life of the app: it holds the Supabase client, and
  // rebuilding it on every session change would drop in-flight uploads.
  const connector = useMemo(() => new SupabaseConnector(), []);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setClerkTokenSource(null);
      // disconnect(), NOT disconnectAndClear(). Clearing would wipe the local
      // database on every sign-out, so the next guard to pick up the phone in
      // a dead zone would find an app with nothing in it — the failure this
      // migration exists to remove. The data that a switched-to user is not
      // entitled to is removed by PowerSync at the next checkpoint instead,
      // because their token resolves to different buckets.
      void db.disconnect();
      return;
    }

    setClerkTokenSource(() => getToken());
    db.connect(connector)
      .then(() => setSyncAuthError(null))
      .catch((err: unknown) => {
        // Offline is normal and not an error worth showing: the local database
        // keeps working and PowerSync retries. A *rejected* connection is a
        // different thing — a JWKS or audience mismatch means nothing will
        // ever sync — and it is recorded so the auth gate can say so instead
        // of presenting an empty app as an unprovisioned account.
        console.warn("PowerSync connect failed", err);
        setSyncAuthError(errorMessage(err));
      });
  }, [isLoaded, isSignedIn, sessionId, getToken, connector]);

  // A refused connection does not reject db.connect(). PowerSync resolves,
  // then retries the stream forever, recording the reason on its status —
  // so without this an authentication failure is a permanently empty app and
  // an empty console. That is precisely the shape of failure this codebase
  // has lost the most time to, and the reason `aud` being absent from a Clerk
  // token surfaced as "unprovisioned account" rather than as itself.
  useEffect(() => {
    const dispose = db.registerListener({
      statusChanged: (status) => {
        const err = status.downloadError ?? status.uploadError;
        if (!err) {
          if (status.connected) setSyncAuthError(null);
          return;
        }
        const message = errorMessage(err);
        // Only *refusals*, not disconnections. A device in a dead zone
        // produces download errors constantly and is working exactly as
        // designed; showing it a configuration screen would be the mirror-image
        // mistake, and a far more common one. PowerSync's PSYNC_S21xx and
        // PSYNC_S22xx classes are the token and auth-integration failures —
        // the ones that no amount of signal will fix.
        if (isAuthRefusal(message)) setSyncAuthError(message);
      },
    });
    return dispose;
  }, []);

  return (
    <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>
  );
}

const AUTH_REFUSAL = /PSYNC_S2[12]\d\d|\b40[13]\b|Unauthorized/i;

function isAuthRefusal(message: string): boolean {
  return AUTH_REFUSAL.test(message);
}

/**
 * The message out of whatever PowerSync hands us.
 *
 * NOT `err instanceof Error`. Sync errors are raised inside a Web Worker and
 * reach this thread by structured clone, which copies `name`, `message` and
 * `stack` and drops the prototype — so the check is false for every one of
 * them, and `String(err)` is the string "[object Object]".
 *
 * This was not theoretical. The first version of this file used `instanceof`,
 * and the result was that a PSYNC_S2105 rejection — a token the service will
 * never accept — was recorded as "[object Object]", failed the refusal test,
 * and left the app showing "find some signal" while the console said exactly
 * what was wrong. Which is the failure this whole file exists to prevent.
 */
function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
