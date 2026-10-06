import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_STYLE, LABEL_STYLE_KEY, loadLabelStyle, newLabel, saveLabelStyle } from "./mapLabelStyle";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("mapLabelStyle", () => {
  it("1 · nothing remembered is the defaults", () => {
    expect(loadLabelStyle(memory())).toEqual(DEFAULT_LABEL_STYLE);
    expect(loadLabelStyle(null)).toEqual(DEFAULT_LABEL_STYLE);
  });
  it("2 · a finished label's style and its offset from the anchor are what the next one starts with", () => {
    const store = memory();
    saveLabelStyle({ cx: 13, cy: 19, rotation: -42, fontSize: 4, paddingX: 0, paddingY: 0 }, { cx: 10, cy: 20 }, store);
    expect(loadLabelStyle(store)).toEqual({ rotation: -42, fontSize: 4, paddingX: 0, paddingY: 0, dx: 3, dy: -1 });
    expect(newLabel({ cx: 55, cy: 66 }, loadLabelStyle(store))).toEqual({ cx: 58, cy: 65, rotation: -42, fontSize: 4, paddingX: 0, paddingY: 0 });
  });
  it("3 · a label that left a field unset remembers the default for it, and no anchor means no offset", () => {
    const store = memory();
    saveLabelStyle({ cx: 1, cy: 2, rotation: 10 }, null, store);
    expect(loadLabelStyle(store)).toEqual({ ...DEFAULT_LABEL_STYLE, rotation: 10 });
  });
  it("4 · garbage in the store is the defaults, not a crash", () => {
    const store = memory();
    store.setItem(LABEL_STYLE_KEY, "{not json");
    expect(loadLabelStyle(store)).toEqual(DEFAULT_LABEL_STYLE);
    store.setItem(LABEL_STYLE_KEY, JSON.stringify({ fontSize: "big", rotation: null }));
    expect(loadLabelStyle(store)).toEqual(DEFAULT_LABEL_STYLE);
  });
  it("5 · a new label stays on the map when the offset would carry it off", () => {
    expect(newLabel({ cx: 99, cy: 1 }, { ...DEFAULT_LABEL_STYLE, dx: 5, dy: -5 })).toMatchObject({ cx: 100, cy: 0 });
  });
});
