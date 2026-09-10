import { describe, expect, it } from "vitest";
import { errorMessage, isConfigurationError } from "./syncErrors";

// Every string below was captured from a real signed-in session against a real
// PowerSync instance during the migration, not invented. The three failures
// arrived in the order they appear here, each one revealed by fixing the last.
const REAL = {
  noSyncRules:
    'HTTP : {"error":{"status":500,"code":"PSYNC_S2302","description":"No sync config available","name":"ServiceError"}}',
  badJwks:
    'HTTP : {"error":{"code":"PSYNC_S2204","status":401,"description":"JWKS request failed","name":"AuthorizationError"}}',
  missingAudience:
    'HTTP : {"error":{"code":"PSYNC_S2105","status":401,"description":"Authorization failed","name":"AuthorizationError"}}',
  offline: "TypeError: Failed to fetch",
};

describe("isConfigurationError", () => {
  it("treats PSYNC_S2302 as configuration, not signal", () => {
    // The regression this function was rewritten for. An instance with no sync
    // rules deployed answered every request with a 500, and the app told the
    // user to move somewhere with better reception.
    expect(isConfigurationError(REAL.noSyncRules)).toBe(true);
  });

  it("treats PSYNC_S2204 as configuration", () => {
    expect(isConfigurationError(REAL.badJwks)).toBe(true);
  });

  it("still treats PSYNC_S2105 as configuration", () => {
    // The original case. The narrower predicate caught this one, so it is the
    // regression guard for the rewrite rather than the reason for it.
    expect(isConfigurationError(REAL.missingAudience)).toBe(true);
  });

  it("treats a bare HTTP refusal as configuration", () => {
    expect(isConfigurationError("401 Unauthorized")).toBe(true);
    expect(isConfigurationError("Request failed with status 403")).toBe(true);
  });

  it("treats a failed fetch as connectivity", () => {
    // The mirror-image mistake, and the more expensive one: a guard behind a
    // boathouse must not be shown a configuration screen.
    expect(isConfigurationError(REAL.offline)).toBe(false);
  });

  it("treats an unrecognised message as connectivity", () => {
    expect(isConfigurationError("connection closed")).toBe(false);
    expect(isConfigurationError("")).toBe(false);
  });

  it("does not mistake a duration for a status code", () => {
    expect(isConfigurationError("retrying in 500ms")).toBe(false);
  });
});

describe("errorMessage", () => {
  it("reads .message off a structured-clone copy with no Error prototype", () => {
    // What actually crosses the Web Worker boundary: the fields survive, the
    // prototype does not, so `instanceof Error` is false and String() gives
    // "[object Object]".
    const cloned = { name: "AuthorizationError", message: REAL.badJwks, stack: "…" };
    expect(cloned instanceof Error).toBe(false);
    expect(String(cloned)).toBe("[object Object]");
    expect(errorMessage(cloned)).toBe(REAL.badJwks);
    expect(isConfigurationError(errorMessage(cloned))).toBe(true);
  });

  it("falls back to String() for a primitive", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(null)).toBe("null");
  });
});
