// The two switches every map carries (mapShow.ts): anchors, and labels.
// Independent - either, both or neither.
import { setMapShow, useMapShow } from "./mapShow";
import { useTranslation } from "react-i18next";

export function MapShowToggle({ compact }: { compact?: boolean }) {
  const { t } = useTranslation("shared");
  const show = useMapShow();
  const opt = (key: "anchors" | "labels", text: string, title: string) => (
    <button
      key={key}
      type="button"
      className={`map-show-opt ${show[key] ? "on" : ""}`}
      title={title}
      aria-pressed={show[key]}
      data-testid={`map-show-${key}`}
      onClick={(e) => {
        e.stopPropagation();
        setMapShow({ [key]: !show[key] });
      }}
    >
      {text}
    </button>
  );
  return (
    <div className={`map-show ${compact ? "map-show-compact" : ""}`} role="group" aria-label={t("map.showGroup")} data-testid="map-show">
      {opt("anchors", t("map.anchors"), t("map.anchorsTitle"))}
      {opt("labels", t("map.labels"), t("map.labelsTitle"))}
    </div>
  );
}
