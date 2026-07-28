import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useClerk } from "@clerk/clerk-react";
import { useCurrent } from "../lib/auth/CurrentUserContext";
import { db } from "../lib/db";
import { visibleSections, MOBILE_TAB_COUNT } from "../routes/nav";
import { ActiveCallPanel } from "../pages/comms/ActiveCallPanel";
import { MissedCommsBadge } from "../pages/comms/MissedCommsBadge";
import { ThemeToggle } from "./ThemeToggle";
import { ADMIN_SECTIONS } from "../pages/admin/adminSections";

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

  // Derived from the route rather than its own toggle state — being on any
  // /admin/* page (including having just clicked "Admin" itself) is what
  // expands the sub-list, and leaving collapses it again. That satisfies
  // "clicking Admin still navigates" for free, since expansion is just a
  // side effect of where the click already lands.
  const adminExpanded = location.pathname.startsWith("/admin");
  const adminSubSections = ADMIN_SECTIONS.filter((s) => current.can(s.requires));

  return (
    <div className="shell">
      <aside className="sidenav">
        <div className="sidenav-brand">MarinaSecure</div>
        <div className="sidenav-marina">{marinaName}</div>
        <nav>
          {sections.map((s) => (
            <div key={s.path}>
              <NavLink
                to={s.path}
                end={s.path === "/"}
                className={({ isActive }) =>
                  "sidenav-item" + (isActive ? " active" : "")
                }
              >
                {s.label}
              </NavLink>
              {s.path === "/admin" && adminExpanded && (
                <div className="sidenav-subnav">
                  {adminSubSections.map((a) => (
                    <NavLink
                      key={a.path}
                      to={a.path}
                      className={({ isActive }) =>
                        "sidenav-subitem" + (isActive ? " active" : "")
                      }
                    >
                      {a.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="sidenav-footer">
          <div className="sidenav-user">{current.user?.name}</div>
          <div className="sidenav-roles">{current.roleNames.join(" · ")}</div>
          <div style={{ marginBottom: 10 }}>
            <ThemeToggle />
          </div>
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

      {/* App-wide: the call panel surfaces whenever a call is live, and the
          missed-comms badge floats over everything. */}
      <ActiveCallPanel />
      <MissedCommsBadge />

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
