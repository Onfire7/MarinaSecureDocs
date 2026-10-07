import { describe, expect, it } from "vitest";
import { parseMapShow, SHOW_BOTH } from "./mapShow";

describe("parseMapShow", () => {
  it("1 · nothing stored is both on", () => {
    expect(parseMapShow(null)).toEqual(SHOW_BOTH);
  });
  it("2 · the three words the first version stored still read", () => {
    expect(parseMapShow("anchors")).toEqual({ anchors: true, labels: false });
    expect(parseMapShow("labels")).toEqual({ anchors: false, labels: true });
    expect(parseMapShow("both")).toEqual(SHOW_BOTH);
  });
  it("3 · the two switches are independent, and neither on is allowed", () => {
    expect(parseMapShow('{"anchors":false,"labels":false}')).toEqual({ anchors: false, labels: false });
    expect(parseMapShow('{"anchors":true,"labels":false}')).toEqual({ anchors: true, labels: false });
  });
  it("4 · a missing key is on; garbage is both on, not a crash", () => {
    expect(parseMapShow('{"labels":false}')).toEqual({ anchors: true, labels: false });
    expect(parseMapShow("{not json")).toEqual(SHOW_BOTH);
    expect(parseMapShow("42")).toEqual(SHOW_BOTH);
    expect(parseMapShow("null")).toEqual(SHOW_BOTH);
  });
});
