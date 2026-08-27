import { useState } from "react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { PERMISSIONS, type Permission } from "../../lib/permissions";
import {
  deleteRole as removeRole,
  renameRole,
  saveRole,
  useRoleHolderCounts,
  useRoles,
  type Role,
} from "../../data/users";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
import { useTextPrompt } from "../shared/TextPromptDialog";

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

// A role edit used to have to walk every user holding it, recomputing their
// cached canManageRoles/canManageUsers. That cache is gone: `user_permissions`
// is recomputed by a database trigger on user_roles and roles, so editing a
// role's grants is one write to one row and every holder's effective
// permissions follow.

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
  const [askText, promptNode] = useTextPrompt();
  const [warning, setWarning] = useState<string | null>(null);

  const { roles } = useRoles();
  const holderCounts = useRoleHolderCounts();

  const setCell = (role: Role, permission: Permission, value: CellValue) => {
    const allow = new Set<string>(role.allow);
    const deny = new Set<string>(role.deny);
    allow.delete(permission);
    deny.delete(permission);
    if (value === "allow") allow.add(permission);
    else if (value === "deny") deny.add(permission);
    const nextAllow = [...allow];
    const nextDeny = [...deny];

    // Warn — but don't block — before manage_roles stops being granted
    // anywhere, which would lock everyone out of this screen. Mirrors the
    // effective-permission rule: any Allow grants, any Deny cancels it.
    if (permission === "manage_roles" && value !== "allow") {
      const after = roles.map((r) =>
        r.id === role.id
          ? { ...r, allow: nextAllow as Permission[], deny: nextDeny as Permission[] }
          : r,
      );
      const anyAllows = after.some((r) => r.allow.includes("manage_roles"));
      const anyDenies = after.some((r) => r.deny.includes("manage_roles"));
      const stillGranted = anyAllows && !anyDenies;
      if (!stillGranted) {
        const ok = window.confirm(
          "No role would grant manage_roles anymore — nobody could reach this screen again without direct database access. Continue?",
        );
        if (!ok) return;
      }
    }

    setWarning(null);
    void saveRole(
      {
        id: role.id,
        name: role.name,
        allow: nextAllow as Permission[],
        deny: nextDeny as Permission[],
      },
      current.user?.id ?? null,
    );
  };

  const addRole = async (from?: Role) => {
    const name = await askText(
      from ? `Name for the copy of ${from.name}:` : "New role name:",
      from ? `${from.name} copy` : "",
    );
    if (!name?.trim()) return;
    // A fresh role starts with everything Undefined; a duplicate copies its
    // source's grants.
    await saveRole(
      {
        name: name.trim(),
        allow: from?.allow ?? [],
        deny: from?.deny ?? [],
      },
      current.user?.id ?? null,
    );
  };

  const rename = async (role: Role) => {
    const name = await askText("Rename role:", role.name);
    if (!name?.trim() || name.trim() === role.name) return;
    await renameRole(role.id, role.name, name.trim(), current.user?.id ?? null);
  };

  const deleteRole = async (role: Role) => {
    const holders = holderCounts.get(role.id) ?? 0;
    const ok = window.confirm(
      holders > 0
        ? `${holders} user${holders === 1 ? "" : "s"} hold "${role.name}". They'll lose whatever it granted — and all role-gated access if it was their only role. Delete it?`
        : `Delete "${role.name}"?`,
    );
    if (!ok) return;
    // user_roles cascades, and the trigger on it recomputes every affected
    // user's permissions — nothing here has to walk the holders.
    await removeRole(role.id, role.name, current.user?.id ?? null);
  };

  const active = roles.find((r) => r.id === selectedRole) ?? roles[0];

  return (
    <div>
      {promptNode}
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
                  onClick={() => void rename(active)}
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
                const v: CellValue = active.allow?.includes(p)
                  ? "allow"
                  : active.deny?.includes(p)
                    ? "deny"
                    : undefined;
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
                        onClick={() => void rename(r)}
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
                    const v: CellValue = r.allow?.includes(p)
                      ? "allow"
                      : r.deny?.includes(p)
                        ? "deny"
                        : undefined;
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
