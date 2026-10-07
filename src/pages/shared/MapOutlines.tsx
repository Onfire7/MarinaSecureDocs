// Outlines on a map (docs/maps.md; lib/outline.ts): each a semi-transparent
// polygon in a colour - the location's status colour where the map has one
// - with a solid edge that stays one width at any zoom. One SVG over the
// image, in the same percent coordinates as everything else on the map,
// drawn under the labels and dots. A shape with an onClick is tappable
// inside, which does what tapping its label does.
import { outlinePoints, type OutlinePoint } from "../../lib/outline";

export interface OutlineItem {
  id: string;
  points: OutlinePoint[];
  /** The fill and edge colour; the fill is drawn see-through. */
  color: string;
  title?: string;
  /** Fainter, for everything but the location in hand. */
  muted?: boolean;
  onClick?: () => void;
  testId?: string;
}

export function MapOutlines({ items }: { items: OutlineItem[] }) {
  if (items.length === 0) return null;
  return (
    <svg className="map-outlines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden={!items.some((i) => i.onClick)}>
      {items.map((i) => (
        <polygon
          key={i.id}
          points={outlinePoints(i.points)}
          className={`${i.muted ? "muted" : ""} ${i.onClick ? "tappable" : ""}`}
          style={{ fill: i.color, stroke: i.color }}
          data-testid={i.testId}
          onClick={
            i.onClick
              ? (e) => {
                  e.stopPropagation();
                  i.onClick!();
                }
              : undefined
          }
        >
          {i.title && <title>{i.title}</title>}
        </polygon>
      ))}
    </svg>
  );
}
