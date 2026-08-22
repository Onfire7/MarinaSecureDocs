// Dark mode toggle (see docs/pages/more.html — Appearance). Default is
// "system" (follow prefers-color-scheme, no attribute needed since app.css's
// dark palette is itself scoped by that same media query). An explicit
// choice sets data-theme on <html>, which both wins over the media query
// (light) and applies regardless of it (dark) — see app.css.
export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

export function getStoredTheme(): ThemePref {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function applyTheme(pref: ThemePref): void {
  if (pref === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = pref;
  }
}

export function setTheme(pref: ThemePref): void {
  if (pref === "system") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, pref);
  }
  applyTheme(pref);
}
