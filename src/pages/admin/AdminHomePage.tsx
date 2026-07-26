import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { ADMIN_SECTIONS } from "./adminSections";

// Admin — Home / Section Picker (see docs/pages/admin-home.html).
// The Admin nav item appears for anyone holding any manage_* permission, but
// each tile is independently gated — a user might reach this page solely
// through manage_assets and see exactly one tile. Tiles they can't open are
// absent, not shown disabled.
export function AdminHomePage() {
  const current = useCurrent();
  const sections = ADMIN_SECTIONS.filter((s) => current.can(s.requires));

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Admin</h1>
      </div>

      {sections.length === 0 ? (
        <div className="placeholder">
          <div className="big">Nothing to configure</div>
          You don't hold any of the permissions these sections require.
        </div>
      ) : (
        <div className="grid-cards">
          {sections.map((s) => (
            <Link
              key={s.path}
              to={s.path}
              className="card"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="card-title">{s.label}</div>
              <div className="card-meta">{s.description}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Shared header for every Admin sub-page. */
export function AdminHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        <div className="page-sub">
          <Link to="/admin">← Admin</Link>
        </div>
      </div>
      {children}
    </div>
  );
}
