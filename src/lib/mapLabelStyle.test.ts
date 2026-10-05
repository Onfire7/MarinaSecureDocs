import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_STYLE, LABEL_STYLE_KEY, loadLabelStyle, newPlacement, reanchored, saveLabelStyle } from "./mapLabelStyle";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("mapLabelStyle", () => {
  it("1 · nothing remembered is the defaults", () => {
    expect(loadLabelStyle(memory())).toEqual(DEFAULT_LABEL_STYLE);
    expect(loadLabelStyle(null)).toEqual(DEFAULT_LABEL_STYLE);
  });
  it("2 · a finished placement's style is what the next one starts with", () => {
    const store = memory();
    saveLabelStyle({ cx: 10, cy: 20, rotation: -42, fontSize: 4, paddingX: 0, paddingY: 0, dx: 3, dy: -1 }, store);
    expect(loadLabelStyle(store)).toEqual({ rotation: -42, fontSize: 4, paddingX: 0, paddingY: 0, dx: 3, dy: -1 });
    expect(newPlacement(55, 66, loadLabelStyle(store))).toEqual({ cx: 55, cy: 66, rotation: -42, fontSize: 4, paddingX: 0, paddingY: 0, dx: 3, dy: -1 });
  });
  it("3 · a placement that left a field unset remembers the default for it", () => {
    const store = memory();
    saveLabelStyle({ cx: 1, cy: 2, rotation: 10 }, store);
    expect(loadLabelStyle(store)).toEqual({ ...DEFAULT_LABEL_STYLE, rotation: 10 });
  });
  it("4 · garbage in the store is the defaults, not a crash", () => {
    const store = memory();
    store.setItem(LABEL_STYLE_KEY, "{not json");
    expect(loadLabelStyle(store)).toEqual(DEFAULT_LABEL_STYLE);
    store.setItem(LABEL_STYLE_KEY, JSON.stringify({ fontSize: "big", rotation: null }));
    expect(loadLabelStyle(store)).toEqual(DEFAULT_LABEL_STYLE);
  });
  it("5 · re-anchoring keeps the label's offset and style, so it moves with the anchor", () => {
    expect(reanchored({ cx: 10, cy: 20, rotation: 5, dx: 2, dy: 2, fontSize: 9 }, 50, 60)).toEqual({ cx: 50, cy: 60, rotation: 5, dx: 2, dy: 2, fontSize: 9 });
  });
});
