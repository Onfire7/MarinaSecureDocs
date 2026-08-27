import { useQuery } from "@powersync/react";
import { db, bool, jsonArray, stamp } from "../lib/db";
import { insert, remove, transact, update } from "./sql";
import { recordActivity } from "./activity";
import type { Permission } from "../lib/permissions";

// Users and roles.
//
// Every device holds every user row: an activity entry, a check-in and an
// assigned ticket all name an actor, and a name that resolves only when online
// would make half the app read "Unknown" on a dock. Roles are the same, and
// small.
//
// What is NOT held is anyone else's permissions. user_permissions syncs for the
// signed-in user alone, so this module can answer "what may I do" and cannot
// answer "what may they do" — which is correct, and is why Admin → Users shows
// role names rather than an effective-permission list per person.

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  clerk_user_id: string | null;
  active: number;
  dashboard_layout: string | null;
  created_at: string;
  contact_id: string | null;
}

export interface RoleRow {
  id: string;
  name: string;
  allow: string | null;
  deny: string | null;
}

export interface Role {
  id: string;
  name: string;
  allow: Permission[];
  deny: Permission[];
}

export function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    allow: jsonArray(row.allow) as Permission[],
    deny: jsonArray(row.deny) as Permission[],
  };
}

export interface UserWithRoles extends UserRow {
  /** Comma-joined in SQL, because SQLite has no array aggregate. */
  role_names: string | null;
  role_ids: string | null;
}

const USER_SELECT = `
  SELECT u.*,
         (SELECT group_concat(r.name, ', ') FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id) AS role_names,
         (SELECT group_concat(ur.role_id, ',') FROM user_roles ur
           WHERE ur.user_id = u.id) AS role_ids
    FROM users u`;

/** Split a group_concat column of ids back into a list. */
export function splitIds(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

/**
 * A user's role names as a list.
 *
 * Separated on ", " rather than "," because a role name may contain a comma
 * and a uuid may not — which is why role_ids and role_names are two columns
 * instead of one. Anything deciding something uses role_ids; this is for
 * display only.
 */
export function roleNames(row: { role_names: string | null }): string[] {
  return row.role_names ? row.role_names.split(", ").filter(Boolean) : [];
}

export function useUsers(includeInactive = false) {
  return useQuery<UserWithRoles>(
    `${USER_SELECT} ${includeInactive ? "" : "WHERE u.active = 1"} ORDER BY u.name`,
  );
}

export function useUser(userId: string | undefined) {
  return useQuery<UserWithRoles>(`${USER_SELECT} WHERE u.id = ?`, [userId ?? ""]);
}

/** The marina records for a set of Clerk identities — the User Switch list. */
export function useUsersByClerkIds(clerkIds: string[]) {
  const placeholders = clerkIds.map(() => "?").join(", ");
  return useQuery<UserWithRoles>(
    clerkIds.length
      ? `${USER_SELECT} WHERE u.clerk_user_id IN (${placeholders})`
      : `${USER_SELECT} WHERE 0`,
    clerkIds,
  );
}

export function useRoles() {
  const { data, isLoading } = useQuery<RoleRow>("SELECT * FROM roles ORDER BY name");
  return { isLoading, roles: data.map(toRole) };
}

export function useRoleIdsFor(userId: string | undefined) {
  const { data } = useQuery<{ role_id: string }>(
    "SELECT role_id FROM user_roles WHERE user_id = ?",
    [userId ?? ""],
  );
  return data.map((r) => r.role_id);
}

export interface UserInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  contactId?: string | null;
  roleIds: string[];
}

export async function createUser(
  input: UserInput,
  actorId: string | null,
): Promise<string> {
  return transact(async (tx) => {
    const userId = await insert(tx, "users", {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      contact_id: input.contactId ?? null,
      active: 1,
      created_at: stamp(),
      // clerk_user_id stays null until that person first signs in, when
      // claim_marina_user() binds it against their verified email. Nothing
      // here can set it: this device has no way to learn another person's
      // Clerk id, and guessing one would be the takeover the function exists
      // to prevent.
    });
    await setUserRoles(tx, userId, input.roleIds);
    await recordActivity(tx, {
      eventType: "user.created",
      summary: `${input.name} added`,
      subjectType: "users",
      subjectId: userId,
      actorId,
    });
    return userId;
  });
}

export async function saveUser(
  userId: string,
  input: UserInput,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "users", userId, {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      contact_id: input.contactId ?? null,
    });
    await setUserRoles(tx, userId, input.roleIds);
    await recordActivity(tx, {
      eventType: "user.updated",
      summary: `${input.name} updated`,
      subjectType: "users",
      subjectId: userId,
      actorId,
    });
  });
}

/**
 * Deactivate rather than delete.
 *
 * `active = false` is a complete revocation, not a UI flag:
 * current_marina_user_id() resolves only active rows, so every policy in the
 * database fails closed for that person at once. Deleting instead would take
 * their name off every check-in and incident they ever authored — the FKs into
 * users are RESTRICT for exactly that reason.
 */
export async function setUserActive(
  userId: string,
  active: boolean,
  name: string,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "users", userId, { active: active ? 1 : 0 });
    await recordActivity(tx, {
      eventType: active ? "user.reactivated" : "user.deactivated",
      summary: `${name} ${active ? "reactivated" : "deactivated"}`,
      subjectType: "users",
      subjectId: userId,
      actorId,
    });
  });
}

/** Replace a user's role links with exactly `roleIds`. */
async function setUserRoles(
  tx: Parameters<Parameters<typeof transact>[0]>[0],
  userId: string,
  roleIds: string[],
): Promise<void> {
  const existing = await tx.getAll<{ id: string; role_id: string }>(
    "SELECT id, role_id FROM user_roles WHERE user_id = ?",
    [userId],
  );
  for (const row of existing) {
    if (!roleIds.includes(row.role_id)) await remove(tx, "user_roles", row.id);
  }
  for (const roleId of roleIds) {
    if (!existing.some((e) => e.role_id === roleId)) {
      await insert(tx, "user_roles", { user_id: userId, role_id: roleId });
    }
  }
}

export async function saveRole(
  role: { id?: string; name: string; allow: Permission[]; deny: Permission[] },
  actorId: string | null,
): Promise<string> {
  return transact(async (tx) => {
    const columns = {
      name: role.name,
      // Postgres text[] columns travel as JSON through PowerSync, in both
      // directions — this is the same encoding jsonArray() reads back.
      allow: JSON.stringify(role.allow),
      deny: JSON.stringify(role.deny),
    };
    const roleId = role.id
      ? (await update(tx, "roles", role.id, columns), role.id)
      : await insert(tx, "roles", columns);
    await recordActivity(tx, {
      eventType: role.id ? "role.permission_changed" : "role.created",
      summary: `${role.name} ${role.id ? "permissions changed" : "created"}`,
      subjectType: "roles",
      subjectId: roleId,
      actorId,
    });
    return roleId;
  });
}

export async function deleteRole(
  roleId: string,
  name: string,
  actorId: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await recordActivity(tx, {
      eventType: "role.deleted",
      summary: `${name} deleted`,
      subjectType: "roles",
      subjectId: roleId,
      actorId,
    });
    await remove(tx, "roles", roleId);
  });
}

/** Whether a user row is usable — `active` as a boolean rather than 0/1. */
export function isActive(user: { active: number }): boolean {
  return bool(user.active);
}

/**
 * The signed-in user's own dashboard arrangement.
 *
 * `null` clears it, which is not the same as saving an empty list: null means
 * "derive from my roles", and an empty list means "I hid everything". The
 * Reset button relies on that difference.
 */
export async function saveDashboardLayout(
  userId: string,
  layout: unknown | null,
): Promise<void> {
  await update(db, "users", userId, {
    dashboard_layout: layout === null ? null : JSON.stringify(layout),
  });
}
