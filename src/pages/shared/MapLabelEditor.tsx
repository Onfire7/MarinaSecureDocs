// The fullscreen map editor (docs/maps.md): a location's place on a map you
// can pinch and pan. Shared by the wizard's GPS and map pages, the Finding
// form and the admin plotter, so there is one way to put a location - or a
// free calibration point - on a map.
//
// A place is an ANCHOR - where the location is, the point its GPS is tied
// to - and a LABEL with coordinates of its own (owner, 2026-10-05: moving
// the anchor leaves the label where it was). Two modes:
//
//   · `anchor`: "tap where you are". Opened right after a GPS fix is
//     captured, it shows a dot and nothing else to adjust; the tap ties the
//     fix to the map. For a free calibration point (no location) the bar
//     also takes the point's name and coordinates, from the device by
//     default. Done returns the anchor - and, for a location that had no
//     label yet, a label in the remembered style beside it;
//   · `label`: the label itself. The bar under the map is one icon per
//     setting - Label (drag or tap to put the label somewhere), Anchor
//     (move the dot), Size, Width, Height, Angle - and tapping one shows ITS
//     slider, alone, with the label brought into the top part of the screen
//     so the slider's effect is seen while the thumb is on it.
//
// Fingers come from touch events, which hand over the whole list of fingers
// every time, so a finger that lifted cannot linger as a ghost (CLAUDE.md).
// The device's own position is drawn through the map's fit when there is
// one. The style a label is finished with is remembered on this device
// (lib/mapLabelStyle.ts). It edits a draft and hands it back on Done;
// Cancel hands back nothing. Rendered through a portal so whatever listens
// to touches beneath it (the wizard owns its touch stream) hears nothing.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { placementStyle, type LabelShape, type MapPoint } from "../../lib/locations";
import { DEFAULT_LABEL_STYLE, loadLabelStyle, newLabel, saveLabelStyle } from "../../lib/mapLabelStyle";
import type { MapFit } from "../../lib/mapFit";
import { labelShapeOf, type MapAnchorRow, type MapLabelRow, type MarinaMapRow } from "../../data/locations";
import { attachmentUrl } from "../../data/files";
import { DeviceDot } from "./DeviceDot";
import { useDevicePosition } from "./useDevicePosition";
import { useMapShow } from "./mapShow";
import { MapShowToggle } from "./MapShowToggle";

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

/** What the editor hands back: the anchor and label as they now stand, and
 *  for a free calibration point its name and coordinates. */
export interface EditedPlace {
  anchor: MapPoint | null;
  label: LabelShape | null;
  point?: { name: string; lat: number | null; lng: number | null };
}

export function MapLabelEditor({
  map,
  anchors,
  labels,
  subject,
  anchor,
  label,
  mode = "label",
  fit = null,
  point,
  coords = false,
  removable,
  removeLabel = "Remove from this map",
  onDone,
  onRemove,
  onCancel,
}: {
  map: MarinaMapRow;
  /** Everything on this map; the subject's own rows are drawn from `anchor` and `label` instead. */
  anchors: MapAnchorRow[];
  labels: MapLabelRow[];
  /** A location, or (locationId null) a free calibration point. */
  subject: { locationId: string | null; name: string };
  anchor: MapPoint | null;
  label: LabelShape | null;
  mode?: "label" | "anchor";
  /** The map's GPS fit, for the device dot. */
  fit?: MapFit | null;
  /** A free point's name and coordinates as they stand. */
  point?: { name: string; lat: number | null; lng: number | null };
  /** Offer coordinates for a LOCATED subject as well - the admin's way to
   *  pin a location while placing it (owner, 2026-10-06). An audit does
   *  not: its capture has rules of its own. */
  coords?: boolean;
  removable?: boolean;
  removeLabel?: string;
  onDone: (place: EditedPlace) => void;
  /** The Remove button; what is removed is the caller's business. */
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const free = subject.locationId === null;
  const [draftAnchor, setDraftAnchor] = useState<MapPoint | null>(anchor);
  const [draftLabel, setDraftLabel] = useState<LabelShape | null>(label);
  const device = useDevicePosition();
  const [pointName, setPointName] = useState(point?.name ?? subject.name);
  const [pointLat, setPointLat] = useState<string>(point?.lat != null ? String(point.lat) : "");
  const [pointLng, setPointLng] = useState<string>(point?.lng != null ? String(point.lng) : "");
  const [tool, setTool] = useState<Tool>(mode === "anchor" ? "anchor" : label ? null : "anchor");
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [port, setPort] = useState({ w: 0, h: 0 });
  const touch = useRef({ start: (_e: TouchEvent) => {}, move: (_e: TouchEvent) => {}, end: (_e: TouchEvent) => {} });
  const gesture = useRef<{ kind: "pan" | "label" | "anchor" | "pinch"; moved: boolean; last: { x: number; y: number }; dist: number } | null>(null);
  const viewRef = useRef(view);
  const commit = (v: View) => {
    viewRef.current = v;
    setView(v);
  };
  const anchorRef = useRef(draftAnchor);
  anchorRef.current = draftAnchor;
  const labelRef = useRef(draftLabel);
  labelRef.current = draftLabel;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const imageUrl = attachmentUrl(map.image_path);
  const show = useMapShow();

  // A point with no coordinates yet takes the device's as they arrive,
  // until the admin types something.
  const wantsCoords = free || coords;
  const typed = useRef(false);
  useEffect(() => {
    if (!wantsCoords || typed.current || !device) return;
    if (pointLat === "" && pointLng === "") {
      setPointLat(device.lat.toFixed(7));
      setPointLng(device.lng.toFixed(7));
    }
  }, [wantsCoords, device, pointLat, pointLng]);

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

  // First sight: the thing being edited close up when there is one; else
  // the device, if the map knows where that is; else the whole map.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !layerH || !port.h) return;
    framed.current = true;
    const fitScale = Math.min(port.w / layerW, port.h / layerH);
    const close = Math.min(MAX_ZOOM, Math.max(fitScale, fitScale * 3));
    const at = mode === "anchor" ? (anchor ?? label) : (label ?? anchor);
    if (at) commit(centreOn({ x: at.cx, y: at.cy }, close, layerW, layerH, port, 0.5));
    else if (fit && device) {
      const d = fit.toMap(device.lat, device.lng);
      commit(centreOn({ x: d.cx, y: d.cy }, close, layerW, layerH, port, 0.5));
    } else commit({ s: fitScale, tx: (port.w - layerW * fitScale) / 2, ty: (port.h - layerH * fitScale) / 2 });
  }, [layerH, layerW, port, anchor, label, mode, fit, device]);

  // Nothing beneath the editor scrolls or zooms while it is up, and
  // nothing in it zooms the PAGE (owner, 2026-10-04).
  const layerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = "hidden";
    const el = layerRef.current;
    const vp = viewportRef.current;
    const twoFingers = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const refuse = (e: Event) => e.preventDefault();
    const start = (e: TouchEvent) => touch.current.start(e);
    const move = (e: TouchEvent) => touch.current.move(e);
    const end = (e: TouchEvent) => touch.current.end(e);
    el?.addEventListener("touchmove", twoFingers, { passive: false });
    el?.addEventListener("touchstart", twoFingers, { passive: false });
    el?.addEventListener("gesturestart", refuse);
    vp?.addEventListener("touchstart", start, { passive: false });
    vp?.addEventListener("touchmove", move, { passive: false });
    vp?.addEventListener("touchend", end);
    vp?.addEventListener("touchcancel", end);
    return () => {
      root.style.overflow = was;
      el?.removeEventListener("touchmove", twoFingers);
      el?.removeEventListener("touchstart", twoFingers);
      el?.removeEventListener("gesturestart", refuse);
      vp?.removeEventListener("touchstart", start);
      vp?.removeEventListener("touchmove", move);
      vp?.removeEventListener("touchend", end);
      vp?.removeEventListener("touchcancel", end);
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
    commit(clampView({ s, tx: at.x - (at.x - v.tx) * kk, ty: at.y - (at.y - v.ty) * kk }));
  };
  const pct = (n: number) => +Math.max(0, Math.min(100, n)).toFixed(2);
  const toPercent = (x: number, y: number): MapPoint => {
    const v = viewRef.current;
    return { cx: pct(((x - v.tx) / (layerW * v.s)) * 100), cy: pct(((y - v.ty) / (layerH * v.s)) * 100) };
  };
  type Pt = { x: number; y: number };
  const localXY = (clientX: number, clientY: number): Pt => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const local = (e: ReactPointerEvent | ReactWheelEvent) => localXY(e.clientX, e.clientY);
  const kindAt = (target: EventTarget | null): "anchor" | "label" | "pan" => {
    const el = target instanceof Element ? target : null;
    return el?.closest("[data-anchor]") ? "anchor" : el?.closest("[data-subject]") && mode === "label" ? "label" : "pan";
  };

  // ── the gesture ─────────────────────────────────────────────────────
  const begin = (kind: "anchor" | "label" | "pan", p: Pt) => {
    gesture.current = { kind, moved: false, last: p, dist: 0 };
  };
  const beginPinch = (a: Pt, b: Pt) => {
    gesture.current = { kind: "pinch", moved: true, last: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const movePinch = (a: Pt, b: Pt) => {
    const g = gesture.current;
    if (!g || g.kind !== "pinch") return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const v = viewRef.current;
    const k = g.dist > 12 && dist > 12 ? dist / g.dist : 1;
    const s = Math.min(MAX_ZOOM, Math.max(0.2, v.s * k));
    const kk = s / v.s;
    commit(clampView({ s, tx: mid.x - (mid.x - v.tx) * kk + (mid.x - g.last.x), ty: mid.y - (mid.y - v.ty) * kk + (mid.y - g.last.y) }));
    g.last = mid;
    g.dist = dist;
  };
  const moveOne = (p: Pt) => {
    const g = gesture.current;
    if (!g || g.kind === "pinch") return;
    const dx = p.x - g.last.x;
    const dy = p.y - g.last.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    g.last = p;
    const v = viewRef.current;
    const ddx = (dx / (layerW * v.s)) * 100;
    const ddy = (dy / (layerH * v.s)) * 100;
    const a = anchorRef.current;
    const l = labelRef.current;
    if (g.kind === "label" && l) setDraftLabel({ ...l, cx: pct(l.cx + ddx), cy: pct(l.cy + ddy) });
    else if (g.kind === "anchor" && a) setDraftAnchor({ cx: pct(a.cx + ddx), cy: pct(a.cy + ddy) });
    else commit({ ...v, tx: v.tx + dx, ty: v.ty + dy });
  };
  const release = (tapAt: Pt | null) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.kind === "pinch" || g.moved || !tapAt) return;
    const at = toPercent(tapAt.x, tapAt.y);
    const t = toolRef.current;
    const a = anchorRef.current;
    const l = labelRef.current;
    if (mode === "anchor" || t === "anchor" || (!a && !l)) {
      // Where the location (or point) is. A location with no label yet
      // gets one beside the anchor, in the remembered style.
      setDraftAnchor(at);
      if (!l && !free && mode === "label") setDraftLabel(newLabel(at, loadLabelStyle()));
      if (mode === "label" && !a && !l) setTool(null);
    } else if (t === "label") {
      setDraftLabel(l ? { ...l, ...at } : { ...newLabel(at, loadLabelStyle()), ...at });
    }
  };

  const pts = (list: TouchList): Pt[] => [...list].map((t) => localXY(t.clientX, t.clientY));
  touch.current = {
    start: (e) => {
      e.preventDefault();
      const t = pts(e.touches);
      if (t.length >= 2) beginPinch(t[0], t[1]);
      else if (t.length === 1) begin(kindAt(e.target), t[0]);
    },
    move: (e) => {
      e.preventDefault();
      const t = pts(e.touches);
      const g = gesture.current;
      if (t.length >= 2) {
        if (!g || g.kind !== "pinch") beginPinch(t[0], t[1]);
        else movePinch(t[0], t[1]);
      } else if (t.length === 1) {
        if (!g) begin("pan", t[0]);
        else if (g.kind === "pinch") gesture.current = { kind: "pan", moved: true, last: t[0], dist: 0 };
        else moveOne(t[0]);
      }
    },
    end: (e) => {
      const t = pts(e.touches);
      if (t.length === 0) {
        const c = e.changedTouches[0];
        release(c ? localXY(c.clientX, c.clientY) : null);
      } else if (t.length === 1) {
        gesture.current = { kind: "pan", moved: true, last: t[0], dist: 0 };
      }
    },
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    viewportRef.current?.setPointerCapture(e.pointerId);
    begin(kindAt(e.target), local(e));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    moveOne(local(e));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    release(local(e));
  };
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY / 400), local(e));
  };

  // A slider is up: bring the label into the top part of the screen.
  const pick = (t: Exclude<Tool, null>) => {
    const next = tool === t ? null : t;
    setTool(next);
    const l = labelRef.current;
    if (next && next !== "label" && next !== "anchor" && l) commit(centreOn({ x: l.cx, y: l.cy }, Math.max(viewRef.current.s, 2), layerW, layerH, port, 0.3));
  };
  const active = TOOLS.find((t) => t.key === tool && t.key !== "label" && t.key !== "anchor");
  const value = (k: Slider) => draftLabel?.[k] ?? DEFAULT_LABEL_STYLE[k];

  const finish = () => {
    let l = draftLabel;
    // Anchored for the first time with no label yet: the label starts in
    // the remembered style beside the anchor, so the map page has one.
    if (!free && draftAnchor && !l && !label) l = newLabel(draftAnchor, loadLabelStyle());
    if (l) saveLabelStyle(l, draftAnchor);
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    onDone({
      anchor: draftAnchor,
      label: free ? null : l,
      point: wantsCoords ? { name: free ? pointName.trim() || "Calibration point" : subject.name, lat: num(pointLat), lng: num(pointLng) } : undefined,
    });
  };
  const canFinish = draftAnchor !== null || draftLabel !== null;

  const otherLabels = labels.filter((b) => b.location_id !== subject.locationId);
  const freePoints = anchors.filter((a) => a.location_id === null && !(free && point && a.label === point.name && a.cx === anchor?.cx && a.cy === anchor?.cy));
  const hint = !draftAnchor && !draftLabel
    ? mode === "anchor"
      ? free
        ? "Tap the spot on the map this point marks."
        : `Tap where you are standing - where ${subject.name} is.`
      : `Tap where ${subject.name} is.`
    : mode === "anchor" || tool === "anchor"
      ? "Drag the dot, or tap where it should be."
      : tool === "label"
        ? "Drag the label, or tap where it should be."
        : null;
  const showLabel = mode === "label" && tool !== "anchor" && draftLabel;
  const body = (
    <div className="mle-layer" ref={layerRef} role="dialog" aria-label={`${subject.name} on ${map.scope_name ?? map.name}`}>
      <div className="mle-top">
        <button type="button" className="btn btn-sm btn-bare" onClick={onCancel}>
          Cancel
        </button>
        <div className="mle-title">
          <b>{free ? pointName || "Calibration point" : subject.name}</b>
          <span className="muted small">{mode === "anchor" ? (free ? "calibration point" : "where it is") : map.scope_name ?? map.name}</span>
        </div>
        <button type="button" className="btn btn-sm btn-primary" data-testid="mle-done" disabled={!canFinish} onClick={finish}>
          Done
        </button>
      </div>
      <div
        className={`mle-viewport ${!canFinish || tool === "anchor" || tool === "label" ? "mle-placing" : ""}`}
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div className="mle-map" style={{ width: layerW, height: layerH || undefined, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, "--zs": view.s } as React.CSSProperties}>
          {imageUrl && <img src={imageUrl} alt={map.name} className="map-image" draggable={false} onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
          {show !== "anchors" &&
            otherLabels.map((b) => (
              <span key={b.id} className="map-rect mle-other" style={placementStyle(labelShapeOf(b))}>
                {b.location_name}
              </span>
            ))}
          {show !== "labels" &&
            anchors
              .filter((a) => a.location_id !== subject.locationId)
              .filter((a) => a.location_id === null ? freePoints.includes(a) : show === "anchors")
              .map((a) => (
                <span
                  key={a.id}
                  className={`map-anchor ${a.location_id === null ? "map-anchor-free" : "map-anchor-other"}`}
                  style={{ left: `${a.cx}%`, top: `${a.cy}%` }}
                  title={a.location_id === null ? (a.label ?? "Calibration point") : (a.location_name ?? "")}
                  aria-hidden
                />
              ))}
          <DeviceDot fit={fit} position={device} />
          {showLabel && (
            <span className="map-rect mle-subject" data-subject data-testid="mle-subject" style={placementStyle(draftLabel!)}>
              {subject.name}
            </span>
          )}
          {draftAnchor && (
            <>
              {showLabel && draftLabel && Math.hypot(draftLabel.cx - draftAnchor.cx, draftLabel.cy - draftAnchor.cy) > 0.5 ? (
                <span className="mle-tether" style={{ ...tetherStyle(draftAnchor, draftLabel), borderTopWidth: 1.5 / view.s }} aria-hidden />
              ) : null}
              <span
                className={`mle-anchor ${free ? "mle-anchor-free" : ""}`}
                data-anchor
                data-testid="mle-anchor"
                style={{ left: `${draftAnchor.cx}%`, top: `${draftAnchor.cy}%` }}
                title={`${subject.name} is here`}
              />
            </>
          )}
        </div>
        {hint && <div className="mle-hint">{hint}</div>}
        <div className="mle-show">
          <MapShowToggle compact />
        </div>
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
              onChange={(e) => draftLabel && setDraftLabel({ ...draftLabel, [active.key]: Number(e.target.value) })}
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
                disabled={!canFinish || (t.key !== "label" && t.key !== "anchor" && !draftLabel)}
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
            {removable && onRemove && (
              <button type="button" className="mle-tool mle-tool-danger" aria-label={removeLabel} onClick={onRemove}>
                <span className="mle-tool-icon" aria-hidden>
                  ✕
                </span>
                <span className="mle-tool-label">Remove</span>
              </button>
            )}
          </div>
        )}
        {mode === "anchor" && !free && !coords && (
          <div className="mle-anchor-note muted small">
            {draftAnchor ? "The dot is where the coordinates you just captured belong on this map." : "Zoom in, then tap the spot you are standing on."}
          </div>
        )}
        {coords && !free && (
          <div className="mle-point-form" data-testid="mle-coords">
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted small">GPS</span>
              <input className="input select-inline" style={{ width: 120 }} placeholder="latitude" aria-label="Latitude" inputMode="decimal" value={pointLat} onChange={(e) => { typed.current = true; setPointLat(e.target.value); }} />
              <input className="input select-inline" style={{ width: 120 }} placeholder="longitude" aria-label="Longitude" inputMode="decimal" value={pointLng} onChange={(e) => { typed.current = true; setPointLng(e.target.value); }} />
              <button type="button" className="btn btn-sm" disabled={!device} data-testid="mle-use-position" onClick={() => device && (setPointLat(device.lat.toFixed(7)), setPointLng(device.lng.toFixed(7)))}>
                Use my position{device ? ` · ±${Math.round(device.accuracy)} m` : ""}
              </button>
            </div>
          </div>
        )}
        {mode === "anchor" && free && (
          <div className="mle-point-form">
            <input className="input" placeholder="What this point is (NE dock corner)" aria-label="Name" value={pointName} onChange={(e) => setPointName(e.target.value)} />
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <input className="input select-inline" style={{ width: 130 }} placeholder="latitude" aria-label="Latitude" inputMode="decimal" value={pointLat} onChange={(e) => { typed.current = true; setPointLat(e.target.value); }} />
              <input className="input select-inline" style={{ width: 130 }} placeholder="longitude" aria-label="Longitude" inputMode="decimal" value={pointLng} onChange={(e) => { typed.current = true; setPointLng(e.target.value); }} />
              <button type="button" className="btn btn-sm" disabled={!device} onClick={() => device && (setPointLat(device.lat.toFixed(7)), setPointLng(device.lng.toFixed(7)))}>
                Use my position{device ? ` · ±${Math.round(device.accuracy)} m` : ""}
              </button>
              {removable && onRemove && (
                <button type="button" className="btn btn-sm btn-bare" style={{ color: "var(--bad)" }} onClick={onRemove}>
                  {removeLabel}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

function centreOn(at: { x: number; y: number }, s: number, layerW: number, layerH: number, port: { w: number; h: number }, yFraction: number): View {
  return { s, tx: port.w / 2 - (at.x / 100) * layerW * s, ty: port.h * yFraction - (at.y / 100) * layerH * s };
}

/** A line from the anchor to the label, so the pair reads as one. */
function tetherStyle(anchor: MapPoint, label: MapPoint): React.CSSProperties {
  const dx = label.cx - anchor.cx;
  const dy = label.cy - anchor.cy;
  return {
    left: `${anchor.cx}%`,
    top: `${anchor.cy}%`,
    width: `${Math.hypot(dx, dy)}%`,
    transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
  };
}
