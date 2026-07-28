import { useState } from "react";
import { getStoredTheme, setTheme, type ThemePref } from "../lib/theme";

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getStoredTheme);

  return (
    <div className="chip-row" style={{ marginBottom: 0 }}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className={"chip" + (pref === o.value ? " active" : "")}
          onClick={() => {
            setTheme(o.value);
            setPref(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
