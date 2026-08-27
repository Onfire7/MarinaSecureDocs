import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useQuery, useStatus } from "@powersync/react";
import { supabase } from "../db/supabase";
import type { Database } from "../db";
import { setSyncAuthError } from "./syncAuthStatus";
import type { Permission } from "../permissions";

export type UserRow = Database["users"];

export interface CurrentUser {
  /** The marina's own user record for the active Clerk session. */
  user: UserRow | null;
  /** True while Clerk, the first sync, or the user query is still resolving. */
  isLoading: boolean;
  /**
   * There is a verified Clerk session, but no active user record belongs to
   * it — the account was never provisioned in Admin → Users, or was
   * deactivated. Per the Sign In spec both present the same generic failure.
   */
  unprovisioned: boolean;
  /**
   * This device has never completed a sync and is offline, so it holds no
   * data at all and cannot tell an unprovisioned account from an unsynced
   * one. Distinct from `unprovisioned` because the remedy is opposite: find
   * signal, rather than find a manager.
   */
  needsFirstSync: boolean;
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
  isAdmin: boolean;
  roleNames: string[];
}

/**
 * Resolves the active Clerk identity to this marina's own user record.
 *
 * Permissions come from `user_permissions`, not from recomputing the role
 * arrays on the device. That table is the same one the sync streams gate on
 * and the same one `has_permission()` reads in every RLS policy, so a control
 * this hook shows is a control whose write the database will actually accept.
 * A second, independently-computed answer here would drift, and the way it
 * would present is a button that appears to do nothing.
 */
export function useCurrentUser(): CurrentUser {
  const { isLoaded, isSignedIn, userId: clerkUserId } = useAuth();
  const status = useStatus();

  // "" matches no row, which is what we want while signed out — a query that
  // is merely absent would leave the previous user's result on screen through
  // a User Switch.
  const key = clerkUserId ?? "";

  const { data: users, isLoading: usersLoading } = useQuery<UserRow>(
    "SELECT * FROM users WHERE clerk_user_id = ? AND active = 1",
    [key],
  );
  const user = users[0] ?? null;

  const { data: permissionRows } = useQuery<{ permission: string }>(
    "SELECT permission FROM user_permissions WHERE user_id = ?",
    [user?.id ?? ""],
  );

  const { data: roleRows } = useQuery<{ name: string }>(
    `SELECT r.name FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
      ORDER BY r.name`,
    [user?.id ?? ""],
  );

  // First sign-in. The user row is provisioned by email with no clerk_user_id,
  // so nothing here matches it and — because every RLS policy joins on that
  // column — this session currently has no identity in the database at all.
  // claim_marina_user() binds the two, using only the verified email in the
  // JWT. It is the one call in the app that goes to Postgres directly, because
  // it necessarily runs before this device can sync anything.
  const claimed = useRef<string | null>(null);
  useEffect(() => {
    if (!isSignedIn || !clerkUserId) return;
    if (user || usersLoading) return;
    if (!status.hasSynced) return; // Absence proves nothing until we've synced.
    if (claimed.current === clerkUserId) return;
    claimed.current = clerkUserId;

    void supabase
      .rpc("claim_marina_user")
      .then(({ error }) => {
        if (error) {
          // A failure here is indistinguishable from an unprovisioned account
          // in the UI unless it is recorded — and the most likely cause is
          // Supabase not trusting Clerk as a third-party auth provider, which
          // is a deployment fault, not the user's.
          console.warn("claim_marina_user failed", error);
          setSyncAuthError(error.message);
        }
      });
  }, [isSignedIn, clerkUserId, user, usersLoading, status.hasSynced]);

  const permissions = useMemo(
    () => new Set(permissionRows.map((r) => r.permission as Permission)),
    [permissionRows],
  );

  const signedIn = Boolean(isSignedIn && clerkUserId);
  const neverSynced = signedIn && !status.hasSynced;

  return {
    user,
    // Note the asymmetry with `needsFirstSync`: a device that has never synced
    // and has no connection is not loading, it is stuck, and saying so is the
    // difference between a spinner that ends and one that does not.
    isLoading:
      !isLoaded || (signedIn && (usersLoading || (neverSynced && status.connected))),
    unprovisioned: signedIn && status.hasSynced && !usersLoading && !user,
    needsFirstSync: neverSynced && !status.connected,
    permissions,
    can: (p) => permissions.has(p),
    isAdmin: [...permissions].some((p) => p.startsWith("manage_")),
    roleNames: roleRows.map((r) => r.name),
  };
}
