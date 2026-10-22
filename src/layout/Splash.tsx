import { useTranslation } from "react-i18next";

// The full-screen "Loading…" shown while Clerk loads, while the marina user
// resolves, and while the authenticated app's chunk downloads.
export function Splash() {
  const { t } = useTranslation("layout");
  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="marina-name">MarinaSecure</div>
        <div className="product">{t("loading")}</div>
      </div>
    </div>
  );
}
