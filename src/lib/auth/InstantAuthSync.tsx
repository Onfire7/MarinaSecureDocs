import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { db } from "../db";
import { INSTANT_CLERK_CLIENT_NAME } from "../config";

// Keeps InstantDB's auth in step with Clerk's active session: InstantDB is
// configured to trust Clerk's session JWT (see docs: Stack & Architecture —
// Authentication). Re-runs whenever the active Clerk session changes, which is
// exactly the shared-device User Switch flow.
export function InstantAuthSync() {
  const { isLoaded, isSignedIn, sessionId, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    if (!isSignedIn) {
      db.auth.signOut({ invalidateToken: false }).catch(() => {});
      return;
    }

    (async () => {
      const idToken = await getToken();
      if (cancelled || !idToken) return;
      await db.auth.signInWithIdToken({
        clientName: INSTANT_CLERK_CLIENT_NAME,
        idToken,
      });
    })().catch((err) => {
      // Offline is a normal condition: the existing local Instant session (if
      // any) keeps working; sync will re-establish auth on reconnect.
      console.warn("InstantDB auth sync failed", err);
    });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, sessionId, getToken]);

  return null;
}
