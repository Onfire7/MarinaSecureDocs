import { describe, expect, it } from "vitest";
import { publicOrigin } from "./config";

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
