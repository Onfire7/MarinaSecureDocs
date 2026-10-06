// The anchors / labels / both switch every map carries (mapShow.ts).
import { setMapShow, useMapShow, type MapShow } from "./mapShow";

const OPTIONS: { key: MapShow; text: string; title: string }[] = [
  { key: "anchors", text: "◎ Anchors", title: "Where locations are" },
  { key: "labels", text: "Labels", title: "What the map says" },
  { key: "both", text: "Both", title: "Anchors and labels" },
];

export function MapShowToggle({ compact }: { compact?: boolean }) {
  const show = useMapShow();
  return (
    <div className={`map-show ${compact ? "map-show-compact" : ""}`} role="group" aria-label="Show on the map" data-testid="map-show">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`map-show-opt ${show === o.key ? "on" : ""}`}
          title={o.title}
          aria-pressed={show === o.key}
          onClick={(e) => {
            e.stopPropagation();
            setMapShow(o.key);
          }}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}
