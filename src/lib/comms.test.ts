import { describe, expect, it } from "vitest";
import { formatCallDuration, formatPhone, isParticipant } from "./comms";

describe("isParticipant", () => {
  const room = {
    id: "r1",
    created_by_id: "creator",
    invitedUserIds: ["invited"],
    invitedRoleIds: ["security"],
  };

  it("counts the creator, a direct invite, and a role invite", () => {
    expect(isParticipant(room, "creator", [])).toBe(true);
    expect(isParticipant(room, "invited", [])).toBe(true);
    expect(isParticipant(room, "someone", ["security"])).toBe(true);
  });

  it("excludes an uninvited user and a signed-out one", () => {
    expect(isParticipant(room, "someone", ["office"])).toBe(false);
    expect(isParticipant(room, undefined, ["security"])).toBe(false);
  });

  it("tolerates a room with no invite lists loaded", () => {
    expect(isParticipant({ id: "r2", created_by_id: "c" }, "other", ["security"])).toBe(false);
  });
});

describe("formatCallDuration", () => {
  it("renders m:ss with a zero-padded seconds field", () => {
    expect(formatCallDuration(65)).toBe("1:05");
    expect(formatCallDuration(5)).toBe("0:05");
    expect(formatCallDuration(600)).toBe("10:00");
  });

  it("renders a dash when the duration is unknown", () => {
    // A call still in progress has no duration yet; "0:00" would read as a
    // hang-up.
    expect(formatCallDuration(null)).toBe("—");
    expect(formatCallDuration(undefined)).toBe("—");
  });
});

describe("formatPhone", () => {
  it("formats 10-digit and 1-prefixed 11-digit numbers identically", () => {
    expect(formatPhone("5551234567")).toBe("(555) 123-4567");
    expect(formatPhone("15551234567")).toBe("(555) 123-4567");
    expect(formatPhone("+1 (555) 123-4567")).toBe("(555) 123-4567");
  });

  it("passes anything it can't parse through unchanged", () => {
    // Twilio can deliver short codes and international numbers; mangling one
    // is worse than showing it raw.
    expect(formatPhone("12345")).toBe("12345");
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });

  it("names the absent case rather than rendering blank", () => {
    expect(formatPhone(null)).toBe("Unknown number");
    expect(formatPhone("")).toBe("Unknown number");
  });
});
