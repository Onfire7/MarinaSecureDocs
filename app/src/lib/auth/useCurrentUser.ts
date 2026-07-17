import { useEffect, useMemo } from "react";
import { useUser } from "@clerk/clerk-react";
import { db } from "../db";
import type { UserWithRoles } from "../db";
import {
  computeEffectivePermissions,
  hasAnyManagePermission,
  type Permission,
} from "../permissions";

export interface CurrentUser {
  /** The marina's User record (with roles) for the active Clerk session. */
  user: UserWithRoles | null;
  /** True while either Clerk or the user query is still resolving. */
  isLoading: boolean;
  /**
   * The Clerk session authenticated but no active User record exists for it —
   * the account was never provisioned via Admin → Users, or was deactivated.
   * Per the Sign In spec both cases present the same generic failure.
   */
  unprovisioned: boolean;
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
  isAdmin: boolean;
  roleNames: string[];
}

// Resolves the active Clerk identity to the marina's own User record.
// Users are provisioned via Admin → Users; clerkUserId is set on first
// sign-in (matched by email), per the Data Model.
export function useCurrentUser(): CurrentUser {
  const { isLoaded, user: clerkUser } = useUser();
  const clerkUserId = clerkUser?.id;
  const email = clerkUser?.primaryEmailAddress?.emailAddress;

  const { data, isLoading } = db.useQuery(
    clerkUserId
      ? {
          users: {
            $: {
              where: {
                or: [
                  { clerkUserId },
                  ...(email ? [{ email }] : []),
                ],
              },
            },
            roles: {},
          },
        }
      : null,
  );

  const candidates = (data?.users ?? []) as UserWithRoles[];
  const byClerkId = candidates.find((u) => u.clerkUserId === clerkUserId);
  const byEmail = candidates.find((u) => !u.clerkUserId && u.email === email);
  const matched = byClerkId ?? byEmail ?? null;
  const user = matched && matched.active ? matched : null;

  // First sign-in: claim the email-matched User record for this Clerk identity.
  useEffect(() => {
    if (byEmail && !byClerkId && byEmail.active && clerkUserId) {
      db.transact(db.tx.users[byEmail.id].update({ clerkUserId })).catch(
        console.error,
      );
    }
  }, [byEmail, byClerkId, clerkUserId]);

  const permissions = useMemo(
    () => computeEffectivePermissions(user?.roles ?? []),
    [user],
  );

  return {
    user,
    isLoading: !isLoaded || (Boolean(clerkUserId) && isLoading),
    unprovisioned: Boolean(clerkUserId) && !isLoading && !user,
    permissions,
    can: (p) => permissions.has(p),
    isAdmin: hasAnyManagePermission(permissions),
    roleNames: (user?.roles ?? []).map((r) => r.name),
  };
}
