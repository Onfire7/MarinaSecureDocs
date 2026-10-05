// The label settings the last placement was made with - font size,
// padding, rotation - remembered per device (owner, 2026-10-04: local
// storage, not a marina setting), so the next label placed starts where
// the last one was left rather than at the defaults. A dock's labels are
// all the same size and angle; the auditor should set that once.
import { DEFAULT_PLACEMENT_STYLE, type PlacementShape } from "./locations";

export const LABEL_STYLE_KEY = "marinasecure.mapLabelStyle";

export type LabelStyle = Required<Pick<PlacementShape, "fontSize" | "paddingX" | "paddingY" | "rotation">>;

export const DEFAULT_LABEL_STYLE: LabelStyle = { ...DEFAULT_PLACEMENT_STYLE, rotation: 0 };

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
    };
  } catch {
    return DEFAULT_LABEL_STYLE;
  }
}

/** Remember the style a placement was finished with. */
export function saveLabelStyle(shape: PlacementShape, store: StoreLike | null = defaultStore()): void {
  if (!store) return;
  const style: LabelStyle = {
    fontSize: num(shape.fontSize, DEFAULT_LABEL_STYLE.fontSize),
    paddingX: num(shape.paddingX, DEFAULT_LABEL_STYLE.paddingX),
    paddingY: num(shape.paddingY, DEFAULT_LABEL_STYLE.paddingY),
    rotation: num(shape.rotation, DEFAULT_LABEL_STYLE.rotation),
  };
  try {
    store.setItem(LABEL_STYLE_KEY, JSON.stringify(style));
  } catch {
    // Private mode, full quota: forgetting is the worst case.
  }
}

/** A new placement at `cx, cy` in the remembered style. */
export function newPlacement(cx: number, cy: number, style: LabelStyle): PlacementShape {
  return { cx, cy, ...style };
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
