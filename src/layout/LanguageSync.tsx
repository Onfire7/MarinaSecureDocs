import { useEffect } from "react";
import { useCurrent } from "../lib/auth/CurrentUserContext";
import { useMarinaSettings } from "../data/settings";
import { applyMarinaLanguage, applyUserLanguage } from "../i18n";

// Keeps the localizer in step with the two synced language columns
// (docs/localization.md § Two languages). Renders nothing. Mounted inside
// CurrentUserProvider, so it follows a User Switch, and the moment the
// user row first syncs it replaces the device's cached guess.
export function LanguageSync() {
  const { user } = useCurrent();
  const marinaLanguage = useMarinaSettings().language;

  const userLanguage = user?.language ?? null;
  const loaded = user !== null;
  useEffect(() => {
    if (loaded) applyUserLanguage(userLanguage);
  }, [loaded, userLanguage]);

  useEffect(() => {
    applyMarinaLanguage(marinaLanguage);
  }, [marinaLanguage]);

  return null;
}
