// The fullscreen map editor: one label, placed and styled on a map you can
// pinch and pan (owner, 2026-10-04). Shared by the wizard's map page, the
// Finding form's placement check and the admin plotter, so there is one way
// to put a label on a map.
//
//   · the map fills the screen and zooms - pinch, or the wheel - and pans
//     with one finger; the label is dragged, or placed with a tap when it
//     is not yet on the map (or the Move tool is on);
//   · the bar under the map is one icon per setting - size, width, height,
//     rotation - and tapping one shows ITS slider, alone. While a slider
//     is up the label is brought into the top part of the screen, so what
//     the slider does can be seen while the thumb is on it;
//   · the style the label is finished with is remembered on this device
//     (lib/mapLabelStyle.ts), so the next label starts there.
//
// It edits a draft and hands it back on Done; Cancel hands back nothing.
// What the caller does with the shape - save it, propose it - is its own
// business. It is rendered through a portal so that whatever is listening
// to touches beneath it (the wizard owns its touch stream) hears nothing.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { placementStyle, type PlacementShape } from "../../lib/locations";
import { DEFAULT_LABEL_STYLE, loadLabelStyle, newPlacement, saveLabelStyle } from "../../lib/mapLabelStyle";
import { placementOf, type MarinaMapRow, type PlacementRow } from "../../data/locations";
import { attachmentUrl } from "../../data/files";

type Tool = "move" | "fontSize" | "paddingX" | "paddingY" | "rotation" | null;

const TOOLS: { key: Exclude<Tool, null>; icon: string; label: string; min?: number; max?: number }[] = [
  { key: "move", icon: "✥", label: "Move" },
  { key: "fontSize", icon: "A", label: "Size", min: 2, max: 32 },
  { key: "paddingX", icon: "↔", label: "Width", min: 0, max: 24 },
  { key: "paddingY", icon: "↕", label: "Height", min: 0, max: 24 },
  { key: "rotation", icon: "⟳", label: "Angle", min: -180, max: 180 },
];
const MAX_ZOOM = 8;

interface View {
  s: number;
  tx: number;
  ty: number;
}

export function MapLabelEditor({
  map,
  placements,
  subject,
  shape,
  removable,
  removeLabel = "Remove from this map",
  onDone,
  onCancel,
}: {
  map: MarinaMapRow;
  /** Every placement on this map; the subject's own, if any, is drawn from `shape` instead. */
  placements: PlacementRow[];
  subject: { locationId: string; name: string };
  /** Where the subject is now, or null when it is not on the map yet. */
  shape: PlacementShape | null;
  removable?: boolean;
  removeLabel?: string;
  /** The shape to keep, or null when the label was removed. */
  onDone: (shape: PlacementShape | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PlacementShape | null>(shape);
  const [tool, setTool] = useState<Tool>(shape ? null : "move");
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [port, setPort] = useState({ w: 0, h: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "label" | "pinch"; moved: boolean; last: { x: number; y: number }; dist: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const imageUrl = attachmentUrl(map.image_path);

  // The layer is as wide as the viewport, the image 100% of it, so a page
  // of coordinates in percent is the same arithmetic everywhere.
  const layerW = port.w;
  const layerH = img && port.w ? (port.w * img.h) / img.w : 0;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setPort({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // First sight: the whole map, or the label itself close up when there is
  // one - that is what the auditor came to look at.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !layerH || !port.h) return;
    framed.current = true;
    const fit = Math.min(port.w / layerW, port.h / layerH);
    if (shape) {
      const s = Math.min(MAX_ZOOM, Math.max(fit, fit * 3));
      setView(centreOn(shape, s, layerW, layerH, port, 0.5));
    } else {
      setView({ s: fit, tx: (port.w - layerW * fit) / 2, ty: (port.h - layerH * fit) / 2 });
    }
  }, [layerH, layerW, port, shape]);

  // Nothing beneath the editor scrolls or zooms while it is up.
  useEffect(() => {
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = was;
    };
  }, []);

  const clampView = (v: View): View => {
    const fit = Math.min(port.w / layerW, port.h / layerH) || 1;
    const s = Math.min(MAX_ZOOM, Math.max(fit * 0.8, v.s));
    return { s, tx: v.tx, ty: v.ty };
  };
  const zoomAt = (k: number, at: { x: number; y: number }) => {
    const v = viewRef.current;
    const s = Math.min(MAX_ZOOM, Math.max(0.2, v.s * k));
    const kk = s / v.s;
    setView(clampView({ s, tx: at.x - (at.x - v.tx) * kk, ty: at.y - (at.y - v.ty) * kk }));
  };
  const toPercent = (x: number, y: number) => {
    const v = viewRef.current;
    return {
      cx: +Math.max(0, Math.min(100, ((x - v.tx) / (layerW * v.s)) * 100)).toFixed(2),
      cy: +Math.max(0, Math.min(100, ((y - v.ty) / (layerH * v.s)) * 100)).toFixed(2),
    };
  };
  const local = (e: ReactPointerEvent | ReactWheelEvent) => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    viewportRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", moved: true, last: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const onLabel = e.target instanceof Element && e.target.closest("[data-subject]") !== null;
    gesture.current = { kind: onLabel ? "label" : "pan", moved: false, last: p, dist: 0 };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const v = viewRef.current;
      const k = g.dist > 0 ? dist / g.dist : 1;
      const s = Math.min(MAX_ZOOM, Math.max(0.2, v.s * k));
      const kk = s / v.s;
      setView(clampView({ s, tx: mid.x - (mid.x - v.tx) * kk + (mid.x - g.last.x), ty: mid.y - (mid.y - v.ty) * kk + (mid.y - g.last.y) }));
      g.last = mid;
      g.dist = dist;
      return;
    }
    const dx = p.x - g.last.x;
    const dy = p.y - g.last.y;
    if (!g.moved && Math.hypot(p.x - g.last.x, p.y - g.last.y) < 4) return;
    g.moved = true;
    g.last = p;
    if (g.kind === "label") {
      const d = draftRef.current;
      if (!d) return;
      const v = viewRef.current;
      setDraft({ ...d, cx: +Math.max(0, Math.min(100, d.cx + (dx / (layerW * v.s)) * 100)).toFixed(2), cy: +Math.max(0, Math.min(100, d.cy + (dy / (layerH * v.s)) * 100)).toFixed(2) });
    } else {
      const v = viewRef.current;
      setView({ ...v, tx: v.tx + dx, ty: v.ty + dy });
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) gesture.current = null;
    else if (g?.kind === "pinch" && pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      gesture.current = { kind: "pan", moved: true, last: rest, dist: 0 };
    }
    if (!g || g.kind === "pinch" || g.moved || !p) return;
    // A tap. Placing a label that is not on the map yet, or moving one
    // with the Move tool on, is a tap where it should be.
    const d = draftRef.current;
    if (!d || tool === "move") {
      const at = toPercent(p.x, p.y);
      setDraft(d ? { ...d, ...at } : newPlacement(at.cx, at.cy, loadLabelStyle()));
      if (!d) setTool(null);
    }
  };
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY / 400), local(e));
  };

  // A slider is up: bring the label into the top part of the screen, where
  // the bar does not cover it and the thumb is nowhere near it.
  const pick = (t: Exclude<Tool, null>) => {
    const next = tool === t ? null : t;
    setTool(next);
    const d = draftRef.current;
    if (next && next !== "move" && d) setView(centreOn(d, Math.max(viewRef.current.s, 2), layerW, layerH, port, 0.3));
  };
  const active = TOOLS.find((t) => t.key === tool && t.key !== "move");
  const value = (k: Exclude<Tool, null | "move">) => draft?.[k] ?? DEFAULT_LABEL_STYLE[k];

  const finish = () => {
    if (draft) saveLabelStyle(draft);
    onDone(draft);
  };

  const others = placements.filter((p) => p.location_id !== subject.locationId);
  const body = (
    <div className="mle-layer" role="dialog" aria-label={`Place ${subject.name} on ${map.scope_name ?? map.name}`}>
      <div className="mle-top">
        <button type="button" className="btn btn-sm btn-bare" onClick={onCancel}>
          Cancel
        </button>
        <div className="mle-title">
          <b>{subject.name}</b>
          <span className="muted small">{map.scope_name ?? map.name}</span>
        </div>
        <button type="button" className="btn btn-sm btn-primary" data-testid="mle-done" onClick={finish}>
          Done
        </button>
      </div>
      <div
        className={`mle-viewport ${tool === "move" || !draft ? "mle-placing" : ""}`}
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div className="mle-map" style={{ width: layerW, height: layerH || undefined, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}>
          {imageUrl && <img src={imageUrl} alt={map.name} className="map-image" draggable={false} onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
          {others.map((p) => (
            <span key={p.id} className="map-rect mle-other" style={placementStyle(placementOf(p))}>
              {p.location_name}
            </span>
          ))}
          {draft && (
            <span className="map-rect mle-subject" data-subject data-testid="mle-subject" style={placementStyle(draft)}>
              {subject.name}
            </span>
          )}
        </div>
        {!draft && <div className="mle-hint">Tap where {subject.name} is.</div>}
        {draft && tool === "move" && <div className="mle-hint">Drag the label, or tap where it should be.</div>}
      </div>
      <div className="mle-bar">
        {active && (
          <div className="mle-slider">
            <span className="mle-slider-label">
              {active.label} · {value(active.key as Exclude<Tool, null | "move">)}
              {active.key === "rotation" ? "°" : "px"}
            </span>
            <input
              type="range"
              min={active.min}
              max={active.max}
              value={value(active.key as Exclude<Tool, null | "move">)}
              aria-label={active.label}
              onChange={(e) => draft && setDraft({ ...draft, [active.key]: Number(e.target.value) })}
            />
          </div>
        )}
        <div className="mle-tools">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`mle-tool ${tool === t.key ? "on" : ""}`}
              disabled={!draft && t.key !== "move"}
              aria-label={t.label}
              aria-pressed={tool === t.key}
              onClick={() => pick(t.key)}
            >
              <span className="mle-tool-icon" aria-hidden>
                {t.icon}
              </span>
              <span className="mle-tool-label">{t.label}</span>
            </button>
          ))}
          {removable && draft && (
            <button type="button" className="mle-tool mle-tool-danger" aria-label={removeLabel} onClick={() => onDone(null)}>
              <span className="mle-tool-icon" aria-hidden>
                ✕
              </span>
              <span className="mle-tool-label">Remove</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

/** The view that puts the label's centre at `(50%, fraction of the height)`. */
function centreOn(shape: PlacementShape, s: number, layerW: number, layerH: number, port: { w: number; h: number }, yFraction: number): View {
  const lx = (shape.cx / 100) * layerW * s;
  const ly = (shape.cy / 100) * layerH * s;
  return { s, tx: port.w / 2 - lx, ty: port.h * yFraction - ly };
}
