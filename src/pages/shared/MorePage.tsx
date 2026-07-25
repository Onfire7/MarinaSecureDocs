import { Link, useNavigate } from "react-router-dom";
import { useClerk } from "@clerk/clerk-react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { visibleSections, MOBILE_TAB_COUNT } from "../../routes/nav";

// Mobile "Other" tab — the sections that don't fit in the bottom tab bar,
// plus the account actions the desktop sidenav footer carries.
export function MorePage() {
  const current = useCurrent();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const overflow = visibleSections(current).slice(MOBILE_TAB_COUNT);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">More</h1>
      </div>
      <div className="stack">
        {overflow.map((s) => (
          <Link key={s.path} to={s.path} className="card spread" style={{ textDecoration: "none", color: "inherit" }}>
            <span style={{ fontWeight: 650 }}>
              <span style={{ marginRight: 10 }}>{s.icon}</span>
              {s.label}
            </span>
            <span className="muted">›</span>
          </Link>
        ))}
      </div>
      <hr className="divider" />
      <div className="card">
        <div className="card-title">{current.user?.name}</div>
        <div className="card-meta">{current.roleNames.join(" · ")}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate("/switch-user")}
          >
            Switch user
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
