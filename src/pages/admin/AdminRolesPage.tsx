import { useMemo, useState } from "react";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { PERMISSIONS, type Permission } from "../../lib/permissions";
import { activityTx } from "../../lib/activityLog";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";

// Admin — Roles & Permissions (see docs/pages/admin-roles-permissions.html).
// The one screen that directly edits the trinary model: it doesn't compute
// effective permissions (that happens per-request everywhere else), it just
// edits the per-role Allow / Deny / Undefined settings feeding it. Changes
// take effect immediately — no publish step.
export function AdminRolesPage() {
  return (
    <AdminGate requires="manage_roles">
      <Roles />
    </AdminGate>
  );
}

type RoleRow = {
  id: string;
  name: string;
  permissions: Record<string, "allow" | "deny">;
};

type CellValue = "allow" | "deny" | undefined;

function nextValue(v: CellValue): CellValue {
  // Allow → Deny → Undefined → Allow
  if (v === "allow") return "deny";
  if (v === "deny") return undefined;
  return "allow";
}

function cellLabel(v: CellValue): string {
  return v === "allow" ? "✓" : v === "deny" ? "✕" : "";
}

function cellClass(v: CellValue): string {
  return v === "allow"
    ? "perm-cell perm-allow"
    : v === "deny"
      ? "perm-cell perm-deny"
      : "perm-cell";
}

function Roles() {
  const current = useCurrent();
  const isMobile = useIsMobile();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const { data } = db.useQuery({ roles: { users: {} } });
  const roles = useMemo(
    () => [...((data?.roles ?? []) as RoleRow[])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const setCell = (role: RoleRow, permission: Permission, value: CellValue) => {
    const next = { ...(role.permissions ?? {}) };
    if (value === undefined) delete next[permission];
    else next[permission] = value;

    // Warn — but don't block — before manage_roles stops being granted
    // anywhere, which would lock everyone out of this screen. Mirrors the
    // effective-permission rule: any Allow grants, any Deny cancels it.
    if (permission === "manage_roles" && value !== "allow") {
      const after = roles.map((r) => (r.id === role.id ? { ...r, permissions: next } : r));
      const anyAllows = after.some((r) => r.permissions?.manage_roles === "allow");
      const anyDenies = after.some((r) => r.permissions?.manage_roles === "deny");
      const stillGranted = anyAllows && !anyDenies;
      if (!stillGranted) {
        const ok = window.confirm(
          "No role would grant manage_roles anymore — nobody could reach this screen again without direct database access. Continue?",
        );
        if (!ok) return;
      }
    }

    setWarning(null);
    void db.transact([
      db.tx.roles[role.id].update({ permissions: next }),
      activityTx({
        eventType: "role.permission_changed",
        summary: `${role.name}: ${permission} set to ${value ?? "undefined"}`,
        subjectType: "roles",
        subjectId: role.id,
        actorId: current.user?.id,
      }),
    ]);
  };

  const addRole = async (from?: RoleRow) => {
    const name = window.prompt(
      from ? `Name for the copy of ${from.name}:` : "New role name:",
      from ? `${from.name} copy` : "",
    );
    if (!name?.trim()) return;
    const roleId = id();
    await db.transact([
      db.tx.roles[roleId].update({
        name: name.trim(),
        // A fresh role starts with everything Undefined.
        permissions: from ? { ...(from.permissions ?? {}) } : {},
      }),
      activityTx({
        eventType: "role.created",
        summary: from
          ? `Role "${name.trim()}" duplicated from "${from.name}"`
          : `Role "${name.trim()}" created`,
        subjectType: "roles",
        subjectId: roleId,
        actorId: current.user?.id,
      }),
    ]);
  };

  const renameRole = async (role: RoleRow) => {
    const name = window.prompt("Rename role:", role.name);
    if (!name?.trim() || name.trim() === role.name) return;
    await db.transact([
      db.tx.roles[role.id].update({ name: name.trim() }),
      activityTx({
        eventType: "role.renamed",
        summary: `Role "${role.name}" renamed to "${name.trim()}"`,
        subjectType: "roles",
        subjectId: role.id,
        actorId: current.user?.id,
      }),
    ]);
  };

  const deleteRole = async (role: RoleRow & { users?: { id: string }[] }) => {
    const holders = (role.users ?? []).length;
    const ok = window.confirm(
      holders > 0
        ? `${holders} user${holders === 1 ? "" : "s"} hold "${role.name}". They'll lose whatever it granted — and all role-gated access if it was their only role. Delete it?`
        : `Delete "${role.name}"?`,
    );
    if (!ok) return;
    await db.transact([
      db.tx.roles[role.id].delete(),
      activityTx({
        eventType: "role.deleted",
        summary: `Role "${role.name}" deleted`,
        subjectType: "roles",
        subjectId: role.id,
        actorId: current.user?.id,
      }),
    ]);
  };

  const active = roles.find((r) => r.id === selectedRole) ?? roles[0];

  return (
    <div>
      <AdminHeader title="Roles & Permissions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => void addRole()}
        >
          + Add role
        </button>
      </AdminHeader>

      {warning && (
        <div className="badge badge-warn" style={{ display: "block", marginBottom: 12 }}>
          {warning}
        </div>
      )}

      <p className="muted small" style={{ marginBottom: 12 }}>
        Each cell cycles Allow (✓) → Deny (✕) → Undefined. Deny always wins over
        Allow; Undefined means the role has no opinion. Changes apply immediately.
      </p>

      {roles.length === 0 ? (
        <div className="placeholder">
          <div className="big">No roles defined</div>
          Marinas usually start with Security, Maintenance, Office, Marina
          Manager, and Owner.
        </div>
      ) : isMobile ? (
        // A matrix needs width; mobile edits one role at a time instead.
        <div>
          <div className="chip-row">
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                className={"chip" + (active?.id === r.id ? " active" : "")}
                onClick={() => setSelectedRole(r.id)}
              >
                {r.name}
              </button>
            ))}
          </div>
          {active && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => void renameRole(active)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => void addRole(active)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => void deleteRole(active)}
                >
                  Delete
                </button>
              </div>
              {PERMISSIONS.map((p) => {
                const v = active.permissions?.[p];
                return (
                  <div key={p} className="card spread">
                    <code className="small">{p}</code>
                    <button
                      type="button"
                      className={cellClass(v)}
                      onClick={() => setCell(active, p, nextValue(v))}
                    >
                      {cellLabel(v) || "—"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="matrix-scroll">
          <table className="table matrix-table">
            <thead>
              <tr>
                <th>Permission</th>
                {roles.map((r) => (
                  <th key={r.id}>
                    <div>{r.name}</div>
                    <div className="row" style={{ gap: 2, marginTop: 4 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        title="Rename"
                        onClick={() => void renameRole(r)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        title="Duplicate"
                        onClick={() => void addRole(r)}
                      >
                        ⧉
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        title="Delete"
                        onClick={() => void deleteRole(r)}
                      >
                        ✕
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td>
                    <code className="small">{p}</code>
                  </td>
                  {roles.map((r) => {
                    const v = r.permissions?.[p];
                    return (
                      <td key={r.id} style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className={cellClass(v)}
                          onClick={() => setCell(r, p, nextValue(v))}
                          title={v ?? "undefined"}
                        >
                          {cellLabel(v)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
