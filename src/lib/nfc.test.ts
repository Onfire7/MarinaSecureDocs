import { afterEach, describe, expect, it, vi } from "vitest";
import { checkpointGuidFromUrl, nfcPermissionGranted } from "./nfc";

const GUID = "eb68bde1-f707-4495-8aec-ab90275494a1";

function at(origin: string) {
  vi.stubGlobal("window", { location: { origin } });
}

afterEach(() => vi.unstubAllGlobals());

describe("checkpointGuidFromUrl", () => {
  it("reads the guid from a tag written on another origin", () => {
    // Every tag in the marina was written by beta and carries its origin. The
    // guid is looked up in this marina's own database, so a foreign tag simply
    // fails to resolve; refusing on origin only made real tags dead.
    at("https://beta2.marinasecure.com");
    expect(checkpointGuidFromUrl(`https://beta.marinasecure.com/checkin/${GUID}`)).toBe(GUID);
  });

  it("reads the guid from a same-origin tag", () => {
    at("https://beta2.marinasecure.com");
    expect(checkpointGuidFromUrl(`https://beta2.marinasecure.com/checkin/${GUID}`)).toBe(GUID);
  });

  it("ignores a URL that isn't a check-in link", () => {
    at("https://beta2.marinasecure.com");
    expect(checkpointGuidFromUrl("https://beta2.marinasecure.com/locations/x")).toBeNull();
    expect(checkpointGuidFromUrl("https://example.com/")).toBeNull();
    expect(checkpointGuidFromUrl(`https://example.com/checkin/${GUID}/extra`)).toBeNull();
  });

  it("ignores malformed input", () => {
    at("https://beta2.marinasecure.com");
    expect(checkpointGuidFromUrl("http://")).toBeNull();
  });
});

describe("nfcPermissionGranted", () => {
  const permissions = (state: string | Error) => ({
    permissions: {
      query: async () => {
        if (state instanceof Error) throw state;
        return { state };
      },
    },
  });

  it("is true once the guard has allowed NFC", async () => {
    vi.stubGlobal("navigator", permissions("granted"));
    expect(await nfcPermissionGranted()).toBe(true);
  });

  it("is false while Chrome would still have to ask", async () => {
    // Asking needs a tap. Starting a scan on open without one would throw, and
    // a permission prompt nobody asked for is worse than a button.
    vi.stubGlobal("navigator", permissions("prompt"));
    expect(await nfcPermissionGranted()).toBe(false);
    vi.stubGlobal("navigator", permissions("denied"));
    expect(await nfcPermissionGranted()).toBe(false);
  });

  it("is false where the permission cannot be queried", async () => {
    vi.stubGlobal("navigator", permissions(new TypeError("nfc is not a valid permission")));
    expect(await nfcPermissionGranted()).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await nfcPermissionGranted()).toBe(false);
  });
});
