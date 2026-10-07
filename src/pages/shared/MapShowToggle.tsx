// The two switches every map carries (mapShow.ts): anchors, and labels.
// Independent - either, both or neither.
import { setMapShow, useMapShow } from "./mapShow";

export function MapShowToggle({ compact }: { compact?: boolean }) {
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
    <div className={`map-show ${compact ? "map-show-compact" : ""}`} role="group" aria-label="Show on the map" data-testid="map-show">
      {opt("anchors", "◎ Anchors", "Where locations are")}
      {opt("labels", "Labels", "What the map says")}
    </div>
  );
}
