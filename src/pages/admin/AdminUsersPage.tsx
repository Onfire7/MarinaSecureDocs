import { useMemo, useState } from "react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { computeEffectivePermissions } from "../../lib/permissions";
import {
  createUser,
  roleNames,
  saveUser,
  setUserActive,
  splitIds,
  useRoles,
  useUsers,
  type Role,
  type UserWithRoles,
} from "../../data/users";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";

// Admin — Users (see docs/pages/admin-users.html).
// The only way users enter the system — there's no self-serve signup.
export function AdminUsersPage() {
  return (
    <AdminGate requires="manage_users">
      <Users />
    </AdminGate>
  );
}

function Users() {
  const current = useCurrent();
  const [search, setSearch] = useState("");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deactivated users are included: this is the screen where they get
  // reactivated, and hiding them would make that impossible.
  const { data: allUsers } = useUsers(true);
  const { roles: allRoles } = useRoles();
  const users = useMemo(
    () =>
      [...allUsers].sort((a, b) => {
        if (a.active !== b.active) return a.active === 1 ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [allUsers],
  );

  const q = search.trim().toLowerCase();
  const filtered = users.filter(
    (u) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q),
  );

  /**
   * Deactivating the last manage_users holder is blocked outright, not
   * warned about — computed the same way effective permissions are, so a
   * user holding it through any role counts.
   */
  const rolesOf = (u: UserWithRoles): Role[] => {
    const ids = splitIds(u.role_ids);
    return allRoles.filter((r) => ids.includes(r.id));
  };

  const wouldOrphanUserManagement = (target: UserWithRoles): boolean => {
    const remaining = users.filter((u) => u.active === 1 && u.id !== target.id);
    return !remaining.some((u) =>
      computeEffectivePermissions(rolesOf(u)).has("manage_users"),
    );
  };

  const setActive = (user: UserWithRoles, active: boolean) => {
    setError(null);
    if (!active && wouldOrphanUserManagement(user)) {
      setError(
        `${user.name} is the last active user who can manage users. Grant manage_users to someone else before deactivating them.`,
      );
      return;
    }
    void setUserActive(user.id, active, user.name, current.user?.id ?? null);
  };

  return (
    <div>
      <AdminHeader title="Users">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => setInviting(true)}
        >
          + Invite user
        </button>
      </AdminHeader>

      {error && (
        <div className="badge badge-bad" style={{ display: "block", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="chip-row">
        <input
          className="input select-inline"
          style={{ minWidth: 220 }}
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {filtered.map((u) => (
          <div key={u.id} className={"card" + (u.active === 1 ? "" : " card-hidden")}>
            <div className="spread" style={{ flexWrap: "wrap" }}>
              <div>
                <div className="card-title">
                  {u.name}
                  {u.active === 0 && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      Deactivated
                    </span>
                  )}
                  {/* No clerkUserId yet means they've been provisioned here
                      but haven't completed a first sign-in. */}
                  {u.active === 1 && !u.clerk_user_id && (
                    <span className="badge badge-warn" style={{ marginLeft: 8 }}>
                      Hasn't signed in yet
                    </span>
                  )}
                </div>
                <div className="card-meta">
                  {[u.email, u.phone].filter(Boolean).join(" · ") || "No contact info"}
                  {roleNames(u).length > 0 && (
                    <>
                      {" · "}
                      {roleNames(u).map((name) => (
                        <span key={name} className="badge" style={{ marginRight: 4 }}>
                          {name}
                        </span>
                      ))}
                    </>
                  )}
                </div>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => setEditing(editing === u.id ? null : u.id)}
                >
                  {editing === u.id ? "Done" : "Edit"}
                </button>
                <button
                  type="button"
                  className={
                    "btn btn-sm " + (u.active === 1 ? "btn-danger" : "btn-quiet")
                  }
                  onClick={() => setActive(u, u.active !== 1)}
                >
                  {u.active === 1 ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>

            {editing === u.id && (
              <EditUser user={u} allRoles={allRoles} onDone={() => setEditing(null)} />
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="placeholder">
            <div className="big">{users.length === 0 ? "No users yet" : "No matches"}</div>
          </div>
        )}
      </div>

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </div>
  );
}

function EditUser({
  user,
  allRoles,
  onDone,
}: {
  user: UserWithRoles;
  allRoles: Role[];
  onDone: () => void;
}) {
  const current = useCurrent();
  const [form, setForm] = useState({
    name: user.name,
    email: user.email ?? "",
    phone: user.phone ?? "",
  });
  const [roleIds, setRoleIds] = useState(splitIds(user.role_ids));

  // Saving no longer writes anything about what this user MAY DO. Their
  // effective permissions are recomputed by a database trigger off the role
  // links — there is no permission cache on the user row for a client to get
  // wrong, which is how ADR 0002's escalation vector closes.
  const save = async () => {
    await saveUser(
      user.id,
      {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        roleIds,
      },
      current.user?.id ?? null,
    );
    onDone();
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        <input
          className="input select-inline"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Name"
        />
        <input
          className="input select-inline"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="Email"
        />
        <input
          className="input select-inline"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="Phone"
        />
      </div>
      <div className="field">
        <span className="field-label">Roles — a user may hold several</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {allRoles.map((r) => (
            <label key={r.id} className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={roleIds.includes(r.id)}
                onChange={(e) =>
                  setRoleIds(
                    e.target.checked
                      ? [...roleIds, r.id]
                      : roleIds.filter((x) => x !== r.id),
                  )
                }
              />
              <span className="small">{r.name}</span>
            </label>
          ))}
          {allRoles.length === 0 && (
            <span className="muted small">No roles defined yet.</span>
          )}
        </div>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!form.name.trim()}
          onClick={() => void save()}
        >
          Save
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const current = useCurrent();
  const [form, setForm] = useState({ name: "", email: "", phone: "" });

  const invite = async () => {
    // Provisioned with no Clerk identity: it is bound on their first sign-in by
    // claim_marina_user(), against the email they verify. Nothing here can set
    // it — this device has no way to learn someone else's Clerk id.
    await createUser(
      {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        roleIds: [],
      },
      current.user?.id ?? null,
    );
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Invite a user
        </div>
        <div className="field">
          <span className="field-label">Name — required</span>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="field">
          <span className="field-label">Email — required for sign-in matching</span>
          <input
            className="input"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="field">
          <span className="field-label">Phone</span>
          <input
            className="input"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <p className="muted small">
          This provisions the marina-side user record. They gain access by
          signing in with Clerk using this exact email, which claims this
          record on first sign-in. Sending the Clerk invitation email itself
          needs a server-side call that isn't wired up yet.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!form.name.trim() || !form.email.trim()}
            onClick={() => void invite()}
          >
            Provision user
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
