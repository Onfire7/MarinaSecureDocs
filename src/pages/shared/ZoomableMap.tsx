// A map image you can pinch, pan and wheel in place (owner, 2026-10-06),
// for every map that is not the editor: the previews, the admin plotter,
// the location list. Children are the overlays, positioned in percent of
// the image as everywhere else; they ride the transform, and the dots
// among them stay dot-sized through the `--zs` variable (app.css).
//
// Scale 1 is the image fitted to its box, and that is the floor: the map
// never shrinks below what it was given. A drag swallows the click that
// would otherwise follow it, so panning across a label does not open it.
// Fingers come from touch events, which hand over the whole list every
// time, so a lifted finger cannot linger (CLAUDE.md).
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

const MAX_ZOOM = 8;

interface View {
  s: number;
  tx: number;
  ty: number;
}
type Pt = { x: number; y: number };

export function ZoomableMap({
  imageUrl,
  alt,
  className = "",
  children,
  overlay,
  onClick,
  testId,
}: {
  imageUrl: string | null;
  alt: string;
  className?: string;
  children?: ReactNode;
  /** Controls that sit on the map but not in it - a toggle, a hint -
   *  rendered outside the transformed layer so they stay put. */
  overlay?: ReactNode;
  /** A tap or click on the map that was not a drag. */
  onClick?: () => void;
  testId?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const commit = (v: View) => {
    viewRef.current = v;
    setView(v);
  };
  const gesture = useRef<{ kind: "pan" | "pinch"; moved: boolean; last: Pt; dist: number } | null>(null);
  // The click that follows a drag is the drag's, not a tap: swallowed, but
  // only for the moment after the gesture, and never for the map's own
  // controls - a reset tapped after a pan was eaten this way once.
  const swallowUntil = useRef(0);
  const touch = useRef({ start: (_e: TouchEvent) => {}, move: (_e: TouchEvent) => {}, end: (_e: TouchEvent) => {} });

  const size = () => {
    const el = boxRef.current;
    return { w: el?.clientWidth ?? 1, h: el?.clientHeight ?? 1 };
  };
  const clamp = (v: View): View => {
    const { w, h } = size();
    const s = Math.min(MAX_ZOOM, Math.max(1, v.s));
    return { s, tx: Math.min(0, Math.max(w - w * s, v.tx)), ty: Math.min(0, Math.max(h - h * s, v.ty)) };
  };
  const zoomAt = (k: number, at: Pt) => {
    const v = viewRef.current;
    const s = Math.min(MAX_ZOOM, Math.max(1, v.s * k));
    const kk = s / v.s;
    commit(clamp({ s, tx: at.x - (at.x - v.tx) * kk, ty: at.y - (at.y - v.ty) * kk }));
  };
  const local = (clientX: number, clientY: number): Pt => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const begin = (p: Pt) => {
    gesture.current = { kind: "pan", moved: false, last: p, dist: 0 };
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
    const s = Math.min(MAX_ZOOM, Math.max(1, v.s * k));
    const kk = s / v.s;
    commit(clamp({ s, tx: mid.x - (mid.x - v.tx) * kk + (mid.x - g.last.x), ty: mid.y - (mid.y - v.ty) * kk + (mid.y - g.last.y) }));
    g.last = mid;
    g.dist = dist;
  };
  const movePan = (p: Pt) => {
    const g = gesture.current;
    if (!g || g.kind !== "pan") return;
    const dx = p.x - g.last.x;
    const dy = p.y - g.last.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    g.last = p;
    const v = viewRef.current;
    // Unzoomed there is nothing to pan; the page scrolls instead.
    if (v.s <= 1) return;
    commit(clamp({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const release = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g && g.moved) swallowUntil.current = performance.now() + 400;
  };

  // Touch and wheel natively: React registers both as passive, and a
  // passive listener cannot keep the page from scrolling or zooming under
  // a gesture that is ours. Unzoomed, a one-finger drag is left to the
  // page so the map does not trap scrolling; zoomed, the move is
  // prevented so the map pans instead of the page.
  const pts = (list: TouchList): Pt[] => [...list].map((t) => local(t.clientX, t.clientY));
  touch.current = {
    start: (e) => {
      const t = pts(e.touches);
      if (t.length >= 2) {
        e.preventDefault();
        beginPinch(t[0], t[1]);
      } else if (t.length === 1) {
        // No preventDefault on a one-finger start: that is what keeps the
        // browser from turning a tap into a click, and a tap on a label
        // or the reset must still click. The MOVE is prevented instead.
        begin(t[0]);
      }
    },
    move: (e) => {
      const t = pts(e.touches);
      const g = gesture.current;
      if (t.length >= 2) {
        e.preventDefault();
        if (!g || g.kind !== "pinch") beginPinch(t[0], t[1]);
        else movePinch(t[0], t[1]);
      } else if (t.length === 1) {
        if (viewRef.current.s > 1) e.preventDefault();
        if (!g) begin(t[0]);
        else if (g.kind === "pinch") gesture.current = { kind: "pan", moved: true, last: t[0], dist: 0 };
        else movePan(t[0]);
      }
    },
    end: (e) => {
      const t = pts(e.touches);
      if (t.length === 0) release();
      else if (t.length === 1) gesture.current = { kind: "pan", moved: true, last: t[0], dist: 0 };
    },
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const start = (e: TouchEvent) => touch.current.start(e);
    const move = (e: TouchEvent) => touch.current.move(e);
    const end = (e: TouchEvent) => touch.current.end(e);
    const wheel = (e: WheelEvent) => {
      // A plain wheel over an unzoomed map scrolls the page, as it should;
      // ctrl/pinch-wheel zooms, and so does any wheel once zoomed in.
      if (viewRef.current.s <= 1 && !e.ctrlKey) return;
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY / 400), local(e.clientX, e.clientY));
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  // The mouse: drag to pan once zoomed; a drag is not a click.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    begin(local(e.clientX, e.clientY));
    if (viewRef.current.s > 1) boxRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" || !gesture.current) return;
    movePan(local(e.clientX, e.clientY));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    release();
  };
  const onClickCapture = (e: React.MouseEvent) => {
    const own = e.target instanceof Element && e.target.closest(".zmap-reset, .zmap-fixed, .pc-toolbar, .map-show");
    if (!own && performance.now() < swallowUntil.current) {
      e.stopPropagation();
      e.preventDefault();
      swallowUntil.current = 0;
    }
  };
  const zoomed = view.s > 1.01;

  return (
    <div
      ref={boxRef}
      className={`zmap ${className} ${zoomed ? "zmap-zoomed" : ""}`}
      data-testid={testId}
      data-zoom={view.s.toFixed(2)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="zmap-layer" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, "--zs": view.s } as CSSProperties}>
        {imageUrl && <img src={imageUrl} alt={alt} className="map-image" draggable={false} />}
        {children}
      </div>
      {overlay}
      {zoomed && (
        <button
          type="button"
          className="zmap-reset"
          title="Show the whole map"
          aria-label="Show the whole map"
          onClick={(e) => {
            e.stopPropagation();
            commit({ s: 1, tx: 0, ty: 0 });
          }}
        >
          ⤢
        </button>
      )}
    </div>
  );
}
