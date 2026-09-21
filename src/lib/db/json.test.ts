import { describe, expect, it } from "vitest";
import { json } from "./json";

describe("json", () => {
  it("reads a normal value", () => {
    expect(json('{"value":123057}', null)).toEqual({ value: 123057 });
    expect(json('["a","b"]', [])).toEqual(["a", "b"]);
  });

  it("reads a double-encoded value", () => {
    // Copied from production: a checklist answer stored as a JSON string
    // inside its jsonb column. Reading `.value` off the un-unwrapped string is
    // what put "Recorded undefined" on the mileage card.
    const fromProduction =
      '"{\\"type\\":\\"meter_reading\\",\\"assetId\\":\\"0a6cfa20-4fc2-4c49-a6e3-5565aa982987\\",\\"value\\":123057}"';
    expect(json<{ value?: number } | null>(fromProduction, null)).toMatchObject({
      type: "meter_reading",
      value: 123057,
    });
  });

  it("keeps a string that is genuinely just a string", () => {
    expect(json('"hello"', "")).toBe("hello");
  });

  it("falls back on rubbish, null and empty", () => {
    expect(json("{oops", "fallback")).toBe("fallback");
    expect(json(null, 7)).toBe(7);
    expect(json("", 7)).toBe(7);
  });
});
