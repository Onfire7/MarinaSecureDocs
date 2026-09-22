// Trinary role-based permissions (see docs/permissions.md — Enforcement).
//
// This is the *client's* copy of a rule the database also implements. The
// authority is the `effective_permissions` view — allow minus deny, expressed
// as EXCEPT — materialised into `user_permissions`, which is what RLS reads and
// what the sync streams gate on. What follows must agree with it; the tests in
// permissions.test.ts are the executable statement of what "agree" means.
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
  /**
   * Permission keys this role grants / explicitly denies.
   *
   * Two plain arrays rather than one map, originally because InstantDB's rules
   * could test list membership but not index into a JSON map. They stayed two
   * arrays because `EXCEPT` over two `unnest()`s is the clearest possible SQL
   * statement of deny-wins — the shape turned out to suit the destination
   * better than the origin.
   */
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

// computeManagementFlags() used to live here. It wrote canManageRoles and
// canManageUsers onto the user row, because Instant's rules could not compute
// a user's effective permissions and had to read a cache instead — and the
// client wrote that cache, which is precisely the privilege-escalation vector
// ADR 0002 recorded and carried forward.
//
// It is gone, and nothing replaces it. `user_permissions` is maintained by a
// database trigger off `effective_permissions`, so a client cannot write its
// own permissions at all: there is no column to write. The vector closes
// structurally rather than by a rule that has to keep being right.

// The Admin section is visible to anyone holding at least one manage_* permission.
export const MANAGE_PERMISSIONS = PERMISSIONS.filter((p) =>
  p.startsWith("manage_"),
);

export function hasAnyManagePermission(perms: Set<Permission>): boolean {
  return MANAGE_PERMISSIONS.some((p) => perms.has(p));
}
