// Trinary role-based permissions (see docs: permissions.html).
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

export type RolePermissionMap = Partial<Record<Permission, "allow" | "deny">>;

export interface RoleLike {
  name: string;
  permissions?: Record<string, "allow" | "deny">;
}

export function computeEffectivePermissions(roles: RoleLike[]): Set<Permission> {
  const granted = new Set<Permission>();
  const denied = new Set<Permission>();
  for (const role of roles) {
    for (const [key, value] of Object.entries(role.permissions ?? {})) {
      if (!(PERMISSIONS as readonly string[]).includes(key)) continue;
      if (value === "allow") granted.add(key as Permission);
      else if (value === "deny") denied.add(key as Permission);
    }
  }
  for (const p of denied) granted.delete(p);
  return granted;
}

// The Admin section is visible to anyone holding at least one manage_* permission.
export const MANAGE_PERMISSIONS = PERMISSIONS.filter((p) =>
  p.startsWith("manage_"),
);

export function hasAnyManagePermission(perms: Set<Permission>): boolean {
  return MANAGE_PERMISSIONS.some((p) => perms.has(p));
}
