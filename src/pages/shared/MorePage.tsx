import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useClerk } from "@clerk/clerk-react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { visibleSections, MOBILE_TAB_COUNT } from "../../routes/nav";
import { ThemeToggle } from "../../layout/ThemeToggle";
import { LanguageSelect } from "../../layout/LanguageSelect";
import { InstallAppButton } from "../../layout/InstallAppButton";

// Mobile "Other" tab — the sections that don't fit in the bottom tab bar,
// plus the account actions the desktop sidenav footer carries.
export function MorePage() {
  const { t } = useTranslation("layout");
  const current = useCurrent();
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const overflow = visibleSections(current).slice(MOBILE_TAB_COUNT);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t("more")}</h1>
      </div>
      <div className="stack">
        {overflow.map((s) => (
          <Link key={s.path} to={s.path} className="card spread" style={{ textDecoration: "none", color: "inherit" }}>
            <span style={{ fontWeight: 650 }}>
              <span style={{ marginRight: 10 }}>{s.icon}</span>
              {t(`nav.${s.key}`)}
            </span>
            <span className="muted">›</span>
          </Link>
        ))}
      </div>
      <hr className="divider" />
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>{t("appearance")}</div>
        <ThemeToggle />
        <div style={{ marginTop: 10 }}>
          <LanguageSelect />
        </div>
      </div>
      <div className="card">
        <div className="card-title">{current.user?.name}</div>
        <div className="card-meta">{current.roleNames.join(" · ")}</div>
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate("/switch-user")}
          >
            {t("switchUser")}
          </button>
          {/* The sidenav copy of this is desktop-only, and a phone is where
              installing actually matters — without this, mobile has no
              install path at all. */}
          <InstallAppButton />
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => void signOut()}
          >
            {t("signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}
