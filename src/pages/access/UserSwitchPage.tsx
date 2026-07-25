import { useNavigate } from "react-router-dom";
import { useClerk, useSessionList } from "@clerk/clerk-react";
import { db } from "../../lib/db";

type SessionResource = NonNullable<
  ReturnType<typeof useSessionList>["sessions"]
>[number];

import { useCurrentUser } from "../../lib/auth/useCurrentUser";

// Access — User Switch (see pages/user-switch.html).
// Shared-device handoff over Clerk's multi-session support: picking a user
// calls setActive() on their existing session — no credential re-entry, and it
// works offline since both the Clerk session and Instant's local data are
// already on the device.
export function UserSwitchPage() {
  const { isLoaded, sessions, setActive } = useSessionList();
  const { session: activeSession } = useClerk();
  const current = useCurrentUser();
  const navigate = useNavigate();

  const sessionList = (sessions ?? []) as SessionResource[];
  const clerkIds = sessionList
    .map((s) => s.user?.id)
    .filter((id): id is string => Boolean(id));

  // Resolve marina User records (name, roles) for everyone on this device.
  const { data } = db.useQuery(
    clerkIds.length > 0
      ? {
          users: {
            $: { where: { clerkUserId: { $in: clerkIds } } },
            roles: {},
          },
        }
      : null,
  );
  const profileByClerkId = new Map(
    (data?.users ?? []).map((u) => [u.clerkUserId, u]),
  );

  const switchTo = async (session: SessionResource) => {
    await setActive?.({ session: session.id });
    navigate("/", { replace: true });
  };

  const removeSession = async (session: SessionResource) => {
    await session.remove();
  };

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="marina-name">Switch User</div>
        <div className="product">Signed in on this device</div>
      </div>

      <div className="session-list">
        {isLoaded && sessionList.length === 0 && (
          <p className="muted" style={{ textAlign: "center" }}>
            No users are signed in on this device yet.
          </p>
        )}
        {sessionList.map((session) => {
          const clerkUser = session.user;
          const profile = clerkUser
            ? profileByClerkId.get(clerkUser.id)
            : undefined;
          const name =
            profile?.name ??
            clerkUser?.fullName ??
            clerkUser?.primaryEmailAddress?.emailAddress ??
            "Unknown user";
          const roleNames = (profile?.roles ?? []).map((r) => r.name);
          const isActive = session.id === activeSession?.id;
          const isSelf = clerkUser?.id === current.user?.clerkUserId;
          const canRemove = isSelf || current.can("manage_users");
          return (
            <div key={session.id} className="session-item row">
              <button
                type="button"
                onClick={() => void switchTo(session)}
                className="row"
                style={{
                  all: "unset",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flex: 1,
                  cursor: "pointer",
                }}
              >
                <span className="avatar">
                  {clerkUser?.imageUrl ? (
                    <img src={clerkUser.imageUrl} alt="" />
                  ) : (
                    initials(name)
                  )}
                </span>
                <span>
                  <span style={{ display: "block", fontWeight: 650 }}>
                    {name}
                  </span>
                  <span className="muted small">
                    {roleNames.join(" · ") || "—"}
                    {isActive ? " · current" : ""}
                  </span>
                </span>
              </button>
              {canRemove && (
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  title="Remove this user's session from this device"
                  onClick={() => void removeSession(session)}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          className="btn btn-block"
          onClick={() => navigate("/sign-in")}
        >
          + Add another user
        </button>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
