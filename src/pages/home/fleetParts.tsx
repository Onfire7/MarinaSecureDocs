import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { FUEL_STEPS } from "../../lib/fleet";

// The fuel gauge the Fleet card shares with the Fleet Vehicle Item
// (src/pages/checklists/ActiveChecklistPage.spec.md § Fleet Vehicle Item),
// which shows the same vehicles the same way. Its level comes from
// vehicleFuelLevel() in src/lib/fleet.ts.


/** Five steps, E to F. Read-only gauges sit inside tile buttons, so they
 *  can't be buttons themselves. */
export function FuelGauge({ level, onChange }: { level: number | null; onChange?: (level: number) => void }) {
  const { t } = useTranslation("home");
  const low = level != null && level <= 1;
  return (
    <div
      style={{ display: "flex", gap: 3 }}
      data-testid="fuel-gauge"
      data-level={level ?? ""}
      aria-label={level == null ? t("fleet.fuelUnknown") : t("fleet.fuelLevel", { level: FUEL_STEPS[level] })}
      role={onChange ? "group" : "img"}
    >
      {FUEL_STEPS.map((step, i) => {
        const filled = level != null && i <= level;
        const style: CSSProperties = {
          flex: 1,
          minWidth: onChange ? 36 : 10,
          height: onChange ? 34 : 6,
          border: "none",
          borderRadius: 3,
          padding: 0,
          background: filled ? (low ? "var(--bad)" : "var(--good)") : "var(--line)",
          color: filled ? "#fff" : "var(--mute)",
          fontSize: "0.8rem",
          fontWeight: 650,
        };
        return onChange ? (
          <button
            key={step}
            type="button"
            aria-pressed={level === i}
            style={{ ...style, cursor: "pointer" }}
            onClick={() => onChange(i)}
          >
            {step}
          </button>
        ) : (
          <span key={step} style={style} />
        );
      })}
    </div>
  );
}
