import { useMemo, useState } from "react";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { computeEffectivePermissions } from "../../lib/permissions";
import { activityTx } from "../../lib/activityLog";
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

type UserRow = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  active: boolean;
  clerkUserId?: string;
  roles?: { id: string; name: string; permissions: Record<string, "allow" | "deny"> }[];
};

function Users() {
  const current = useCurrent();
  const [search, setSearch] = useState("");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = db.useQuery({ users: { roles: {} }, roles: {} });
  const users = useMemo(
    () =>
      [...((data?.users ?? []) as UserRow[])].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [data],
  );
  const allRoles = data?.roles ?? [];

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
  const wouldOrphanUserManagement = (target: UserRow): boolean => {
    const remaining = users.filter((u) => u.active && u.id !== target.id);
    return !remaining.some((u) =>
      computeEffectivePermissions(u.roles ?? []).has("manage_users"),
    );
  };

  const setActive = (user: UserRow, active: boolean) => {
    setError(null);
    if (!active && wouldOrphanUserManagement(user)) {
      setError(
        `${user.name} is the last active user who can manage users. Grant manage_users to someone else before deactivating them.`,
      );
      return;
    }
    void db.transact([
      db.tx.users[user.id].update({ active }),
      activityTx({
        eventType: active ? "user.reactivated" : "user.deactivated",
        summary: `${user.name} ${active ? "reactivated" : "deactivated"}`,
        subjectType: "users",
        subjectId: user.id,
        actorId: current.user?.id,
      }),
    ]);
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
          <div key={u.id} className={"card" + (u.active ? "" : " card-hidden")}>
            <div className="spread" style={{ flexWrap: "wrap" }}>
              <div>
                <div className="card-title">
                  {u.name}
                  {!u.active && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      Deactivated
                    </span>
                  )}
                  {/* No clerkUserId yet means they've been provisioned here
                      but haven't completed a first sign-in. */}
                  {u.active && !u.clerkUserId && (
                    <span className="badge badge-warn" style={{ marginLeft: 8 }}>
                      Hasn't signed in yet
                    </span>
                  )}
                </div>
                <div className="card-meta">
                  {[u.email, u.phone].filter(Boolean).join(" · ") || "No contact info"}
                  {(u.roles ?? []).length > 0 && (
                    <>
                      {" · "}
                      {(u.roles ?? []).map((r) => (
                        <span key={r.id} className="badge" style={{ marginRight: 4 }}>
                          {r.name}
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
                  className={"btn btn-sm " + (u.active ? "btn-danger" : "btn-quiet")}
                  onClick={() => setActive(u, !u.active)}
                >
                  {u.active ? "Deactivate" : "Reactivate"}
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
  user: UserRow;
  allRoles: { id: string; name: string }[];
  onDone: () => void;
}) {
  const current = useCurrent();
  const [form, setForm] = useState({
    name: user.name,
    email: user.email ?? "",
    phone: user.phone ?? "",
  });
  const [roleIds, setRoleIds] = useState((user.roles ?? []).map((r) => r.id));
  const original = (user.roles ?? []).map((r) => r.id);

  const save = async () => {
    const added = roleIds.filter((r) => !original.includes(r));
    const removed = original.filter((r) => !roleIds.includes(r));
    await db.transact([
      db.tx.users[user.id].update({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
      }),
      ...(added.length > 0 ? [db.tx.users[user.id].link({ roles: added })] : []),
      ...(removed.length > 0 ? [db.tx.users[user.id].unlink({ roles: removed })] : []),
      activityTx({
        eventType: "user.updated",
        summary: `${form.name.trim()} updated`,
        subjectType: "users",
        subjectId: user.id,
        actorId: current.user?.id,
      }),
    ]);
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
    const userId = id();
    await db.transact([
      db.tx.users[userId].update({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        active: true,
      }),
      activityTx({
        eventType: "user.invited",
        summary: `${form.name.trim()} provisioned`,
        subjectType: "users",
        subjectId: userId,
        actorId: current.user?.id,
      }),
    ]);
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
