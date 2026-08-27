import { useNavigate } from "react-router-dom";
import { useClerk, useSessionList } from "@clerk/clerk-react";
import { roleNames, useUsersByClerkIds } from "../../data/users";

type SessionResource = NonNullable<
  ReturnType<typeof useSessionList>["sessions"]
>[number];

import { useCurrentUser } from "../../lib/auth/useCurrentUser";

// Access — User Switch (see pages/user-switch.html).
// Shared-device handoff over Clerk's multi-session support: picking a user
// calls setActive() on their existing session — no credential re-entry, and it
// works offline since both the Clerk session and the marina's data are already
// on the device.
export function UserSwitchPage() {
  const { isLoaded, sessions, setActive } = useSessionList();
  const { session: activeSession } = useClerk();
  const current = useCurrentUser();
  const navigate = useNavigate();

  const sessionList = (sessions ?? []) as SessionResource[];
  const clerkIds = sessionList
    .map((s) => s.user?.id)
    .filter((id): id is string => Boolean(id));

  // Resolve marina user records (name, roles) for everyone on this device.
  // These come from the device's own database, so the handoff list renders in
  // a dead zone — which is the only place a handoff ever actually happens.
  const { data: profiles } = useUsersByClerkIds(clerkIds);
  const profileByClerkId = new Map(
    profiles.map((u) => [u.clerk_user_id, u]),
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
          const roles = profile ? roleNames(profile) : [];
          const isActive = session.id === activeSession?.id;
          const isSelf = clerkUser?.id === current.user?.clerk_user_id;
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
                    {roles.join(" · ") || "—"}
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
