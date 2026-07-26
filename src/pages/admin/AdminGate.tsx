import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import type { Permission } from "../../lib/permissions";

// Every Admin sub-page is independently gated by its own permission — a user
// can reach /admin holding just one manage_* permission, so arriving at a
// section they lack has to be handled, not assumed away.
export function AdminGate({
  requires,
  children,
}: {
  requires: Permission;
  children: ReactNode;
}) {
  const current = useCurrent();
  if (!current.can(requires)) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
        <Link to="/admin">← Back to Admin</Link>
      </div>
    );
  }
  return <>{children}</>;
}
