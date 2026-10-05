// The fullscreen map editor (docs/maps.md): a location's place on a map you
// can pinch and pan. Shared by the wizard's GPS and map pages, the Finding
// form and the admin plotter, so there is one way to put a location on a
// map.
//
// A placement is an ANCHOR - where the location is - and a LABEL that
// hangs off it by an offset (lib/locations.ts, PlacementShape). The editor
// has two modes:
//
//   · `anchor`: "tap where you are". Opened right after a GPS fix is
//     captured, it shows a dot and nothing else to adjust; the tap ties
//     the fix to the map. Done returns the shape re-anchored - label
//     offset and style kept - or, for a location not on the map yet, a new
//     shape in the remembered label style;
//   · `label`: the label itself. The bar under the map is one icon per
//     setting - Label (drag or tap to put the label somewhere, which is
//     the offset), Anchor (move the dot), Size, Width, Height, Angle - and
//     tapping one shows ITS slider, alone, with the label brought into the
//     top part of the screen so the slider's effect is seen while the
//     thumb is on it.
//
// The device's own position is drawn through the map's fit when there is
// one. The style a label is finished with is remembered on this device
// (lib/mapLabelStyle.ts). It edits a draft and hands it back on Done;
// Cancel hands back nothing. It is rendered through a portal so that
// whatever listens to touches beneath it (the wizard owns its touch
// stream) hears nothing.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { labelCentre, placementStyle, type PlacementShape } from "../../lib/locations";
import { DEFAULT_LABEL_STYLE, loadLabelStyle, newPlacement, reanchored, saveLabelStyle } from "../../lib/mapLabelStyle";
import type { MapFit } from "../../lib/mapFit";
import { placementOf, type MarinaMapRow, type PlacementRow } from "../../data/locations";
import { attachmentUrl } from "../../data/files";
import { DeviceDot } from "./DeviceDot";
import { useDevicePosition } from "./useDevicePosition";

type Tool = "label" | "anchor" | "fontSize" | "paddingX" | "paddingY" | "rotation" | null;
type Slider = Exclude<Tool, null | "label" | "anchor">;

const TOOLS: { key: Exclude<Tool, null>; icon: string; label: string; min?: number; max?: number }[] = [
  { key: "label", icon: "✥", label: "Label" },
  { key: "anchor", icon: "◎", label: "Anchor" },
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
  mode = "label",
  fit = null,
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
  mode?: "label" | "anchor";
  /** The map's GPS fit, for the device dot. */
  fit?: MapFit | null;
  removable?: boolean;
  removeLabel?: string;
  /** The shape to keep, or null when the label was removed. */
  onDone: (shape: PlacementShape | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PlacementShape | null>(shape);
  const [tool, setTool] = useState<Tool>(mode === "anchor" ? "anchor" : shape ? null : "anchor");
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [port, setPort] = useState({ w: 0, h: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "label" | "anchor" | "pinch"; moved: boolean; last: { x: number; y: number }; dist: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const imageUrl = attachmentUrl(map.image_path);
  const device = useDevicePosition();

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

  // First sight: the label close up when there is one; else the device,
  // if the map knows where that is; else the whole map.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !layerH || !port.h) return;
    framed.current = true;
    const fitScale = Math.min(port.w / layerW, port.h / layerH);
    const close = Math.min(MAX_ZOOM, Math.max(fitScale, fitScale * 3));
    if (shape) setView(centreOn(mode === "anchor" ? { x: shape.cx, y: shape.cy } : labelCentre(shape), close, layerW, layerH, port, 0.5));
    else if (fit && device) {
      const at = fit.toMap(device.lat, device.lng);
      setView(centreOn({ x: at.cx, y: at.cy }, close, layerW, layerH, port, 0.5));
    } else setView({ s: fitScale, tx: (port.w - layerW * fitScale) / 2, ty: (port.h - layerH * fitScale) / 2 });
  }, [layerH, layerW, port, shape, mode, fit, device]);

  // Nothing beneath the editor scrolls or zooms while it is up - and
  // nothing in it zooms the PAGE. touch-action: none on the whole layer
  // covers Android; a pinch that begins on the top bar or the tool bar
  // would otherwise zoom the browser's viewport and carry Cancel and Done
  // off the screen with it (owner, 2026-10-04). iOS ignores touch-action
  // for pinch, so a non-passive listener refuses two-finger moves and
  // gesturestart as well.
  const layerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = "hidden";
    const el = layerRef.current;
    const twoFingers = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const refuse = (e: Event) => e.preventDefault();
    el?.addEventListener("touchmove", twoFingers, { passive: false });
    el?.addEventListener("touchstart", twoFingers, { passive: false });
    el?.addEventListener("gesturestart", refuse);
    return () => {
      root.style.overflow = was;
      el?.removeEventListener("touchmove", twoFingers);
      el?.removeEventListener("touchstart", twoFingers);
      el?.removeEventListener("gesturestart", refuse);
    };
  }, []);

  const clampView = (v: View): View => {
    const fitScale = Math.min(port.w / layerW, port.h / layerH) || 1;
    return { s: Math.min(MAX_ZOOM, Math.max(fitScale * 0.8, v.s)), tx: v.tx, ty: v.ty };
  };
  const zoomAt = (k: number, at: { x: number; y: number }) => {
    const v = viewRef.current;
    const s = Math.min(MAX_ZOOM, Math.max(0.2, v.s * k));
    const kk = s / v.s;
    setView(clampView({ s, tx: at.x - (at.x - v.tx) * kk, ty: at.y - (at.y - v.ty) * kk }));
  };
  const pct = (n: number) => +Math.max(0, Math.min(100, n)).toFixed(2);
  const toPercent = (x: number, y: number) => {
    const v = viewRef.current;
    return { cx: pct(((x - v.tx) / (layerW * v.s)) * 100), cy: pct(((y - v.ty) / (layerH * v.s)) * 100) };
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
    const el = e.target instanceof Element ? e.target : null;
    const kind = el?.closest("[data-anchor]") ? "anchor" : el?.closest("[data-subject]") && mode === "label" ? "label" : "pan";
    gesture.current = { kind, moved: false, last: p, dist: 0 };
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
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    g.last = p;
    const v = viewRef.current;
    const d = draftRef.current;
    const ddx = (dx / (layerW * v.s)) * 100;
    const ddy = (dy / (layerH * v.s)) * 100;
    if (g.kind === "label" && d) setDraft({ ...d, dx: +((d.dx ?? 0) + ddx).toFixed(2), dy: +((d.dy ?? 0) + ddy).toFixed(2) });
    else if (g.kind === "anchor" && d) setDraft(reanchored(d, pct(d.cx + ddx), pct(d.cy + ddy)));
    else setView({ ...v, tx: v.tx + dx, ty: v.ty + dy });
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
    // A tap. With the Anchor tool on (or no placement yet), it is where the
    // location is; with the Label tool on, it is where the label goes.
    const d = draftRef.current;
    const t = toolRef.current;
    const at = toPercent(p.x, p.y);
    if (!d) {
      setDraft(newPlacement(at.cx, at.cy, loadLabelStyle()));
      if (mode === "label") setTool(null);
    } else if (t === "anchor") setDraft(reanchored(d, at.cx, at.cy));
    else if (t === "label") setDraft({ ...d, dx: +(at.cx - d.cx).toFixed(2), dy: +(at.cy - d.cy).toFixed(2) });
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
    if (next && next !== "label" && next !== "anchor" && d) setView(centreOn(labelCentre(d), Math.max(viewRef.current.s, 2), layerW, layerH, port, 0.3));
  };
  const active = TOOLS.find((t) => t.key === tool && t.key !== "label" && t.key !== "anchor");
  const value = (k: Slider) => draft?.[k] ?? DEFAULT_LABEL_STYLE[k];

  const finish = () => {
    if (draft) saveLabelStyle(draft);
    onDone(draft);
  };

  const others = placements.filter((p) => p.location_id !== subject.locationId);
  const hint = !draft
    ? mode === "anchor"
      ? `Tap where you are standing - where ${subject.name} is.`
      : `Tap where ${subject.name} is.`
    : mode === "anchor" || tool === "anchor"
      ? "Drag the dot, or tap where it should be."
      : tool === "label"
        ? "Drag the label, or tap where it should be."
        : null;
  const body = (
    <div className="mle-layer" ref={layerRef} role="dialog" aria-label={`${subject.name} on ${map.scope_name ?? map.name}`}>
      <div className="mle-top">
        <button type="button" className="btn btn-sm btn-bare" onClick={onCancel}>
          Cancel
        </button>
        <div className="mle-title">
          <b>{subject.name}</b>
          <span className="muted small">{mode === "anchor" ? "where it is" : map.scope_name ?? map.name}</span>
        </div>
        <button type="button" className="btn btn-sm btn-primary" data-testid="mle-done" disabled={!draft} onClick={finish}>
          Done
        </button>
      </div>
      <div
        className={`mle-viewport ${!draft || tool === "anchor" || tool === "label" ? "mle-placing" : ""}`}
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
          <DeviceDot fit={fit} position={device} scale={view.s} />
          {/* With the Anchor tool on, the label is out of the way: the
              dot is what is being placed, and a label on top of it hides
              the spot. */}
          {draft && mode === "label" && tool !== "anchor" && (
            <span className="map-rect mle-subject" data-subject data-testid="mle-subject" style={placementStyle(draft)}>
              {subject.name}
            </span>
          )}
          {draft && (
            <>
              {mode === "label" && tool !== "anchor" && (draft.dx || draft.dy) ? <span className="mle-tether" style={{ ...tetherStyle(draft), borderTopWidth: 1.5 / view.s }} aria-hidden /> : null}
              {/* Counter-scaled: a dot is a dot at any zoom, not a disc. */}
              <span
                className="mle-anchor"
                data-anchor
                data-testid="mle-anchor"
                style={{ left: `${draft.cx}%`, top: `${draft.cy}%`, transform: `translate(-50%, -50%) scale(${1 / view.s})` }}
                title={`${subject.name} is here`}
              />
            </>
          )}
        </div>
        {hint && <div className="mle-hint">{hint}</div>}
      </div>
      <div className="mle-bar">
        {mode === "label" && active && (
          <div className="mle-slider">
            <span className="mle-slider-label">
              {active.label} · {value(active.key as Slider)}
              {active.key === "rotation" ? "°" : "px"}
            </span>
            <input
              type="range"
              min={active.min}
              max={active.max}
              value={value(active.key as Slider)}
              aria-label={active.label}
              onChange={(e) => draft && setDraft({ ...draft, [active.key]: Number(e.target.value) })}
            />
          </div>
        )}
        {mode === "label" && (
          <div className="mle-tools">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`mle-tool ${tool === t.key ? "on" : ""}`}
                disabled={!draft}
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
        )}
        {mode === "anchor" && (
          <div className="mle-anchor-note muted small">
            {draft ? "The dot is where the coordinates you just captured belong on this map." : "Zoom in, then tap the spot you are standing on."}
          </div>
        )}
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

/** The view that puts a point (percent of the map) at the horizontal
 *  centre and `yFraction` of the height. */
function centreOn(at: { x: number; y: number }, s: number, layerW: number, layerH: number, port: { w: number; h: number }, yFraction: number): View {
  return { s, tx: port.w / 2 - (at.x / 100) * layerW * s, ty: port.h * yFraction - (at.y / 100) * layerH * s };
}

/** A line from the anchor to the label, so the offset reads as one. */
function tetherStyle(p: PlacementShape): React.CSSProperties {
  const to = labelCentre(p);
  const dx = to.x - p.cx;
  const dy = to.y - p.cy;
  return {
    left: `${p.cx}%`,
    top: `${p.cy}%`,
    width: `${Math.hypot(dx, dy)}%`,
    transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
  };
}
