import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useClerk } from "@clerk/clerk-react";
import { useCurrent } from "../lib/auth/CurrentUserContext";
import { db } from "../lib/db";
import { visibleSections, MOBILE_TAB_COUNT } from "../routes/nav";

// Responsive shell: persistent left sidenav on desktop, app bar + bottom tab
// bar on mobile (see wireframes — Dashboard frames for both breakpoints).
export function AppShell() {
  const current = useCurrent();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const location = useLocation();

  const sections = visibleSections(current);
  const tabs = sections.slice(0, MOBILE_TAB_COUNT);
  const marinaName = useMarinaName();

  const activeSection = sections.find((s) =>
    s.path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(s.path),
  );
  const inOverflow =
    activeSection !== undefined && !tabs.includes(activeSection);

  return (
    <div className="shell">
      <aside className="sidenav">
        <div className="sidenav-brand">MarinaSecure</div>
        <div className="sidenav-marina">{marinaName}</div>
        <nav>
          {sections.map((s) => (
            <NavLink
              key={s.path}
              to={s.path}
              end={s.path === "/"}
              className={({ isActive }) =>
                "sidenav-item" + (isActive ? " active" : "")
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidenav-footer">
          <div className="sidenav-user">{current.user?.name}</div>
          <div className="sidenav-roles">{current.roleNames.join(" · ")}</div>
          <div className="row">
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
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <header className="appbar">
          <span>{activeSection?.label ?? "MarinaSecure"}</span>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>

      <nav className="tabbar">
        {tabs.map((s) => (
          <NavLink
            key={s.path}
            to={s.path}
            end={s.path === "/"}
            className={({ isActive }) => "tab" + (isActive ? " active" : "")}
          >
            <span className="tab-icon">{s.icon}</span>
            {s.label === "Home" ? "Home" : s.label.split(" ")[0]}
          </NavLink>
        ))}
        <NavLink
          to="/more"
          className={({ isActive }) =>
            "tab" + (isActive || inOverflow ? " active" : "")
          }
        >
          <span className="tab-icon">⋯</span>
          Other
        </NavLink>
      </nav>
    </div>
  );
}

function useMarinaName(): string {
  const { data } = db.useQuery({ marinaSettings: {} });
  return data?.marinaSettings?.[0]?.marinaName ?? "Marina";
}
