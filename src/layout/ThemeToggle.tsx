import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { getStoredTheme, setTheme, type ThemePref } from "../lib/theme";

// `label` is the key into layout:theme.
const OPTIONS: { value: ThemePref; label: "light" | "system" | "dark"; icon: ReactElement }[] = [
  {
    value: "light",
    label: "light",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <circle cx="10" cy="10" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    value: "system",
    label: "system",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <rect x="2" y="3.5" width="16" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 17h6M10 14v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "dark",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path
          d="M16.5 12.3A6.5 6.5 0 0 1 7.7 3.5a6.5 6.5 0 1 0 8.8 8.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const { t } = useTranslation("layout");
  const [pref, setPref] = useState<ThemePref>(getStoredTheme);
  const activeIndex = OPTIONS.findIndex((o) => o.value === pref);

  return (
    <div className="theme-switch" role="radiogroup" aria-label={t("theme.label")}>
      <div
        className="theme-switch-thumb"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          title={t(`theme.${o.label}`)}
          className={"theme-switch-option" + (pref === o.value ? " active" : "")}
          onClick={() => {
            setTheme(o.value);
            setPref(o.value);
          }}
        >
          {o.icon}
          <span className="sr-only">{t(`theme.${o.label}`)}</span>
        </button>
      ))}
    </div>
  );
}
