// Trinary role-based permissions (see docs/permissions.md — including
// Enforcement, which records that all of this is client-side only).
// Each role maps permission → "allow" | "deny" | (absent = undefined).
// Effective value per permission: default Deny; any Allow grants; any explicit
// Deny cancels every Allow. Deny always wins.

export const PERMISSIONS = [
  "create_incidents",
  "view_incidents",
  "assign_ticket_to_self",
  "assign_ticket_to_others",
  "view_owner",
  "view_contact",
  "edit_owner_contact",
  "view_lease",
  "manage_lease",
  "manage_checklists",
  "manage_users",
  "manage_roles",
  "place_calls",
  "view_calls",
  "view_sms",
  "view_reports",
  "view_all_chats",
  "manage_chats",
  "manage_assets",
  "manage_locations",
  "manage_reservations",
  "manage_marina_settings",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleLike {
  name: string;
  // Permission keys this role grants / explicitly denies. Two plain arrays
  // rather than one map<Permission, "allow"|"deny">, because InstantDB's
  // CEL permission rules can test list membership but can't index into a
  // JSON map — see instant.schema.ts (Role) and instant.perms.ts.
  allow?: string[];
  deny?: string[];
}

export function computeEffectivePermissions(roles: RoleLike[]): Set<Permission> {
  const granted = new Set<Permission>();
  const denied = new Set<Permission>();
  for (const role of roles) {
    for (const key of role.allow ?? []) {
      if ((PERMISSIONS as readonly string[]).includes(key)) granted.add(key as Permission);
    }
    for (const key of role.deny ?? []) {
      if ((PERMISSIONS as readonly string[]).includes(key)) denied.add(key as Permission);
    }
  }
  for (const p of denied) granted.delete(p);
  return granted;
}

/**
 * The two booleans written to User.canManageRoles/canManageUsers — the
 * denormalized cache instant.perms.ts rules read. Call this any time a
 * role's grants or a user's role assignments change (Admin Roles / Admin
 * Users), never from the affected user's own session — see instant.perms.ts
 * for why the write itself is gated by manage_users/manage_roles.
 */
export function computeManagementFlags(
  roles: RoleLike[],
): { canManageRoles: boolean; canManageUsers: boolean } {
  const perms = computeEffectivePermissions(roles);
  return {
    canManageRoles: perms.has("manage_roles"),
    canManageUsers: perms.has("manage_users"),
  };
}

// The Admin section is visible to anyone holding at least one manage_* permission.
export const MANAGE_PERMISSIONS = PERMISSIONS.filter((p) =>
  p.startsWith("manage_"),
);

export function hasAnyManagePermission(perms: Set<Permission>): boolean {
  return MANAGE_PERMISSIONS.some((p) => perms.has(p));
}
