import { Trans, useTranslation } from "react-i18next";

interface Props {
  missing: string[];
}

// Shown instead of the app when required per-marina environment configuration
// is absent — each marina deployment supplies its own InstantDB app and Clerk
// application (see docs: Stack & Architecture — Per-marina isolation).
export function ConfigMissingPage({ missing }: Props) {
  const { t } = useTranslation("shared");
  const code = { code: <code /> };
  return (
    <div className="config-missing">
      <h1 style={{ marginBottom: 8 }}>{t("configMissing.title")}</h1>
      <p className="muted">
        <Trans t={t} i18nKey="configMissing.intro" components={code} />
      </p>
      <pre>
        {missing.map((k) => `${k}=…`).join("\n")}
      </pre>
      <p className="muted small">
        <Trans t={t} i18nKey="configMissing.vars" components={code} />
      </p>
    </div>
  );
}
