import { useTranslation } from "react-i18next";
import { useCurrent } from "../lib/auth/CurrentUserContext";
import { saveMyLanguage } from "../data/users";
import { languageName, pickerLanguages } from "../i18n";

// The signed-in user's UI language (docs/localization.md § Two languages).
// Each language is listed in its own name, so someone who cannot read the
// current one can still find theirs. "Device default" stores null.
export function LanguageSelect() {
  const { t } = useTranslation();
  const { user } = useCurrent();
  if (!user) return null;

  return (
    <select
      className="select select-inline"
      data-testid="language-select"
      aria-label={t("language")}
      value={user.language ?? ""}
      onChange={(e) => void saveMyLanguage(user.id, e.target.value || null)}
    >
      <option value="">{t("deviceDefault")}</option>
      {pickerLanguages(user.language).map((code) => (
        <option key={code} value={code} lang={code}>
          {languageName(code)}
        </option>
      ))}
    </select>
  );
}
