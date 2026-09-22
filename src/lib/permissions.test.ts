import { describe, expect, it } from "vitest";
import {
  computeEffectivePermissions,
  hasAnyManagePermission,
} from "./permissions";
import { aRole } from "../test/fixtures";

/**
 * The trinary model, and the closest thing the authorization migration gets
 * to a safety net.
 *
 * These assertions are about to be reimplemented in SQL: the
 * `effective_permissions` view computes allow-minus-deny with `EXCEPT` (see
 * docs/permissions.md). Every case below should hold identically there. If
 * the Postgres version and this one ever disagree, the UI and the database
 * disagree about who can do what — which is the failure mode row-level
 * security exists to prevent.
 */
describe("computeEffectivePermissions", () => {
  it("lets any role's Allow grant a permission", () => {
    const perms = computeEffectivePermissions([
      aRole({ name: "Security", allow: ["create_incidents"] }),
      aRole({ name: "Office" }),
    ]);
    expect(perms.has("create_incidents")).toBe(true);
  });

  it("lets an explicit Deny cancel another role's Allow", () => {
    const security = aRole({ name: "Security", allow: ["assign_ticket_to_others"] });
    const trainee = aRole({ name: "Trainee", deny: ["assign_ticket_to_others"] });
    expect(
      computeEffectivePermissions([security, trainee]).has("assign_ticket_to_others"),
    ).toBe(false);
  });

  it("applies Deny regardless of role order", () => {
    const security = aRole({ name: "Security", allow: ["assign_ticket_to_others"] });
    const trainee = aRole({ name: "Trainee", deny: ["assign_ticket_to_others"] });
    // Deny is not "last write wins" — it is unconditional. Order-dependence
    // here would make a user's permissions depend on link insertion order.
    expect(
      computeEffectivePermissions([trainee, security]).has("assign_ticket_to_others"),
    ).toBe(false);
  });

  it("treats Undefined as no opinion rather than a Deny", () => {
    const opinionated = aRole({ name: "Security", allow: ["view_incidents"] });
    const silent = aRole({ name: "Trainee" });
    expect(computeEffectivePermissions([opinionated, silent]).has("view_incidents")).toBe(true);
  });

  it("defaults to Deny when no role mentions the permission", () => {
    const perms = computeEffectivePermissions([aRole({ name: "Office", allow: ["view_reports"] })]);
    expect(perms.has("view_contact")).toBe(false);
  });

  it("ignores keys outside the fixed catalog", () => {
    // Roles are admin-edited data; a stale or hand-written key must not
    // become a permission the app then checks against.
    const perms = computeEffectivePermissions([
      aRole({ name: "Legacy", allow: ["not_a_real_permission", "view_reports"] }),
    ]);
    expect(perms.has("view_reports" as never)).toBe(true);
    expect([...perms]).not.toContain("not_a_real_permission");
  });
});

describe("hasAnyManagePermission", () => {
  it("is true for any manage_* permission and false for none", () => {
    expect(
      hasAnyManagePermission(computeEffectivePermissions([aRole({ allow: ["manage_assets"] })])),
    ).toBe(true);
    expect(
      hasAnyManagePermission(computeEffectivePermissions([aRole({ allow: ["view_reports"] })])),
    ).toBe(false);
  });
});
