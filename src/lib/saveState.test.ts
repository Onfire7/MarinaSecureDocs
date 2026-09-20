import { describe, expect, it } from "vitest";
import { saveState, type SaveInputs } from "./saveState";

const base: SaveInputs = {
  queued: 0,
  connected: true,
  uploading: false,
  uploadError: null,
  unchangedForMs: 0,
  rejected: 0,
};

describe("saveState", () => {
  it("empty queue reads as all sent", () => {
    expect(saveState(base)).toMatchObject({ kind: "sent", label: "✓ All changes sent" });
  });

  it("queued while offline reads as saved on this phone", () => {
    // The normal condition of a guard in a dead spot. Never alarming, however
    // long it lasts: the work IS saved.
    const s = saveState({ ...base, queued: 3, connected: false, unchangedForMs: 3_600_000 });
    expect(s).toMatchObject({ kind: "waiting", tone: "amber", label: "3 changes saved on this phone" });
  });

  it("uploading reads as sending, with the count", () => {
    expect(saveState({ ...base, queued: 1, uploading: true })).toMatchObject({
      kind: "sending",
      label: "Sending 1 change…",
    });
  });

  it("queued, online and stuck past 60s reads as not sending, with the reason", () => {
    const s = saveState({
      ...base,
      queued: 2,
      unchangedForMs: 61_000,
      uploadError: "Received 503 from /rest/v1/check_ins",
    });
    expect(s).toMatchObject({ kind: "stuck", tone: "danger", label: "2 changes not sending" });
    expect(s.detail).toContain("503");
  });

  it("is still sending, not stuck, just inside the minute", () => {
    expect(saveState({ ...base, queued: 2, unchangedForMs: 59_000 }).kind).toBe("sending");
  });

  it("an expired-token error alone never reads as stuck", () => {
    // Routine after a phone wakes. Two minutes of it is a slow reconnect.
    const waking = { ...base, queued: 4, uploadError: '401 {"code":"PGRST303","message":"JWT expired"}' };
    expect(saveState({ ...waking, unchangedForMs: 120_000 }).kind).toBe("sending");
    // Five minutes of it is a session that is not coming back by itself.
    expect(saveState({ ...waking, unchangedForMs: 301_000 }).kind).toBe("stuck");
  });

  it("a rejected write is reported until dismissed", () => {
    // Outranks everything, including a clean queue: the queue is clean
    // BECAUSE the write was thrown away.
    expect(saveState({ ...base, rejected: 1 })).toMatchObject({
      kind: "rejected",
      tone: "danger",
      label: "1 change rejected by the office",
    });
    expect(saveState({ ...base, rejected: 0 }).kind).toBe("sent");
  });
});
