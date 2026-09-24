import { describe, expect, it } from "vitest";
import { canonicalTarget, publicOrigin } from "./config";

// What goes into a link somebody else opens (src/lib/config.ts). The bug
// this exists for: a share link built from window.location.origin carries
// whatever address the app was open at, and one of this repo's two sites
// is a different build with no /r/ route - so a link that lands there asks
// the recipient to sign in.

describe("publicOrigin", () => {
  it("1 · the configured public address wins, trailing slashes and all", () => {
    expect(publicOrigin("https://beta2.marinasecure.com", "https://marinasecure2.netlify.app")).toBe("https://beta2.marinasecure.com");
    expect(publicOrigin("https://beta2.marinasecure.com/", "https://x.test")).toBe("https://beta2.marinasecure.com");
    expect(publicOrigin("  https://beta2.marinasecure.com//  ", "https://x.test")).toBe("https://beta2.marinasecure.com");
  });
  it("2 · unset or nonsense falls back to where we are, which is right for localhost", () => {
    expect(publicOrigin(undefined, "http://localhost:5173")).toBe("http://localhost:5173");
    expect(publicOrigin("", "http://localhost:5173")).toBe("http://localhost:5173");
    // Netlify leaves $URL empty on some contexts; a bare host is not an origin
    expect(publicOrigin("beta2.marinasecure.com", "http://localhost:5173")).toBe("http://localhost:5173");
  });
});

describe("canonicalTarget", () => {
  const WANT = "https://beta2.marinasecure.com";
  it("3 · a share link on another address is sent home, path and key intact", () => {
    expect(canonicalTarget("https://marinasecure2.netlify.app", "/r/abc-123", WANT)).toBe(
      "https://beta2.marinasecure.com/r/abc-123",
    );
    expect(canonicalTarget("https://beta2--marinasecure2.netlify.app", "/r/abc?x=1", WANT)).toBe(
      "https://beta2.marinasecure.com/r/abc?x=1",
    );
  });
  it("4 · and cannot match itself, so it cannot loop", () => {
    expect(canonicalTarget(WANT, "/r/abc-123", WANT)).toBe(null);
    expect(canonicalTarget(WANT + "/", "/r/abc-123", WANT + "/")).toBe(null);
  });
  it("5 · only the public report moves; the app stays reachable anywhere", () => {
    // Branch deploys and the netlify.app name are how a wrong-origin bug
    // gets tested at all - moving the whole app would end that.
    expect(canonicalTarget("https://marinasecure2.netlify.app", "/audits/123", WANT)).toBe(null);
    expect(canonicalTarget("https://marinasecure2.netlify.app", "/", WANT)).toBe(null);
  });
  it("6 · unconfigured, nothing moves - which is what localhost wants", () => {
    expect(canonicalTarget("http://localhost:5173", "/r/abc", undefined)).toBe(null);
    expect(canonicalTarget("http://localhost:5173", "/r/abc", "")).toBe(null);
  });
});
