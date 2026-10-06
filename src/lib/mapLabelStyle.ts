// The label settings the last label was finished with - size, padding,
// rotation, and where it sat relative to its anchor - remembered per device
// (owner, 2026-10-04: local storage, not a marina setting), so the next
// label placed starts where the last one was left rather than at the
// defaults. A dock's labels are all the same size, angle and offset; the
// auditor should set that once.
import { DEFAULT_PLACEMENT_STYLE, type LabelShape, type MapPoint } from "./locations";

export const LABEL_STYLE_KEY = "marinasecure.mapLabelStyle";

export interface LabelStyle {
  fontSize: number;
  paddingX: number;
  paddingY: number;
  rotation: number;
  /** Where the label sits relative to its anchor, in percent of the map. */
  dx: number;
  dy: number;
}

export const DEFAULT_LABEL_STYLE: LabelStyle = { ...DEFAULT_PLACEMENT_STYLE, rotation: 0, dx: 0, dy: 0 };

interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The remembered style, or the defaults when nothing has been remembered
 *  or what was remembered is not usable. */
export function loadLabelStyle(store: StoreLike | null = defaultStore()): LabelStyle {
  if (!store) return DEFAULT_LABEL_STYLE;
  try {
    const raw = store.getItem(LABEL_STYLE_KEY);
    if (!raw) return DEFAULT_LABEL_STYLE;
    const v = JSON.parse(raw) as Partial<LabelStyle>;
    return {
      fontSize: num(v.fontSize, DEFAULT_LABEL_STYLE.fontSize),
      paddingX: num(v.paddingX, DEFAULT_LABEL_STYLE.paddingX),
      paddingY: num(v.paddingY, DEFAULT_LABEL_STYLE.paddingY),
      rotation: num(v.rotation, DEFAULT_LABEL_STYLE.rotation),
      dx: num(v.dx, DEFAULT_LABEL_STYLE.dx),
      dy: num(v.dy, DEFAULT_LABEL_STYLE.dy),
    };
  } catch {
    return DEFAULT_LABEL_STYLE;
  }
}

/** Remember how a label was finished: its style, and where it sits
 *  relative to its anchor (nowhere in particular when there is no anchor). */
export function saveLabelStyle(label: LabelShape, anchor: MapPoint | null, store: StoreLike | null = defaultStore()): void {
  if (!store) return;
  const style: LabelStyle = {
    fontSize: num(label.fontSize, DEFAULT_LABEL_STYLE.fontSize),
    paddingX: num(label.paddingX, DEFAULT_LABEL_STYLE.paddingX),
    paddingY: num(label.paddingY, DEFAULT_LABEL_STYLE.paddingY),
    rotation: num(label.rotation, DEFAULT_LABEL_STYLE.rotation),
    dx: anchor ? +(label.cx - anchor.cx).toFixed(2) : DEFAULT_LABEL_STYLE.dx,
    dy: anchor ? +(label.cy - anchor.cy).toFixed(2) : DEFAULT_LABEL_STYLE.dy,
  };
  try {
    store.setItem(LABEL_STYLE_KEY, JSON.stringify(style));
  } catch {
    // Private mode, full quota: forgetting is the worst case.
  }
}

/** A new label for an anchor: where the last one sat relative to its
 *  anchor, in the last one's style, kept on the map. */
export function newLabel(anchor: MapPoint, style: LabelStyle): LabelShape {
  const clamp = (n: number) => +Math.max(0, Math.min(100, n)).toFixed(2);
  return { cx: clamp(anchor.cx + style.dx), cy: clamp(anchor.cy + style.dy), rotation: style.rotation, fontSize: style.fontSize, paddingX: style.paddingX, paddingY: style.paddingY };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function defaultStore(): StoreLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
