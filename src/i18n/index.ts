import { initReactI18next } from "react-i18next";
import { CATALOGS, LANGUAGES } from "./catalogs";
import { makeFormatters } from "./format";
import { createLocalizer } from "./localizer";
import { KEYS_MODE, keysModeAfterQuery, resolveUiLanguage } from "./resolveLanguage";

// The app's localizer (docs/localization.md). Imported once by main.tsx,
// before the first render. It must not import Clerk or PowerSync: the public
// report page loads it too.

export { LANGUAGES, KEYS_MODE };

const DEVICE_KEY = "ms.lng";
const KEYS_KEY = "ms.keys";

const keysMode = keysModeAfterQuery(
  new URLSearchParams(location.search).get("lng"),
  localStorage.getItem(KEYS_KEY) === "1",
);
if (keysMode) localStorage.setItem(KEYS_KEY, "1");
else localStorage.removeItem(KEYS_KEY);

function resolve(user: string | null | undefined): string {
  return resolveUiLanguage({
    keysMode,
    user,
    device: localStorage.getItem(DEVICE_KEY),
    navigator: navigator.languages,
    available: LANGUAGES,
  });
}

const localizer = createLocalizer(CATALOGS, resolve(undefined), [initReactI18next]);

export const i18n = localizer.i18n;
export const dataT = localizer.dataT;
export const uiLocale = localizer.uiLocale;
export const { date, time, dateTime, number } = makeFormatters(localizer.uiLocale);

function settle(language: string) {
  localizer.setUiLanguage(language);
  document.documentElement.lang = localizer.uiLocale();
  if (language !== KEYS_MODE) localStorage.setItem(DEVICE_KEY, language);
}

settle(resolve(undefined));

/** Apply the signed-in user's `users.language` (null = follow the device). */
export function applyUserLanguage(language: string | null): void {
  settle(resolve(language));
}

/** Apply `marina_settings.language`, which `dataT` writes in. */
export function applyMarinaLanguage(language: string): void {
  localizer.setDataLanguage(language);
}

/**
 * The languages a picker offers: every available one, plus `current` if it
 * has no catalog (stored before one shipped, or after one was removed), so
 * the select still shows what is actually stored.
 */
export function pickerLanguages(current: string | null): readonly string[] {
  return current && !LANGUAGES.includes(current) ? [...LANGUAGES, current] : LANGUAGES;
}

/** A language's name for itself, for pickers. */
export function languageName(language: string): string {
  return CATALOGS[language]?.common.languageName ?? language;
}
