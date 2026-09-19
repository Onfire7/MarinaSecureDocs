import { beforeEach, describe, expect, it, vi } from "vitest";

// The responses below are the exact bodies captured while reproducing the bug
// this file exists for: checklist answers made in a dead spot were deleted
// from the upload queue, because the request went out with no identity and
// Supabase's reply was mistaken for a permanent refusal.

const token = vi.hoisted(() => ({ value: "jwt" as string | null }));
const reply = vi.hoisted(() => ({
  value: { error: null as unknown, status: 204 },
}));
const calls = vi.hoisted(() => ({ update: 0 }));

vi.mock("@powersync/web", () => ({
  UpdateType: { PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" },
}));
vi.mock("../config", () => ({ POWERSYNC_URL: "http://powersync.test" }));
vi.mock("../auth/clerkToken", () => ({
  getClerkToken: async () => token.value,
}));
vi.mock("../auth/syncStatus", () => ({ setSyncConfigError: () => {} }));
vi.mock("./supabase", () => ({
  supabase: {
    from: () => {
      const send = () => {
        calls.update += 1;
        return Promise.resolve(reply.value);
      };
      return {
        upsert: send,
        update: () => ({ eq: send }),
        delete: () => ({ eq: send }),
      };
    },
  },
}));

import { SupabaseConnector } from "./connector";

function queueOf(op: { op: string; table: string; id: string; opData?: object }) {
  const complete = vi.fn(async () => {});
  const database = {
    getNextCrudTransaction: async () => ({ crud: [op], complete }),
  };
  return { database: database as never, complete };
}

const CHECK = {
  op: "PATCH",
  table: "checklist_instance_items",
  id: "a57483b0-b48d-48e4-8000-000000000000",
  opData: { result: "{}" },
};

describe("SupabaseConnector.uploadData", () => {
  beforeEach(() => {
    token.value = "jwt";
    reply.value = { error: null, status: 204 };
    calls.update = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("clears the write from the queue on success", async () => {
    const { database, complete } = queueOf(CHECK);
    await new SupabaseConnector().uploadData(database);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("doesn't send a write when there is no Clerk token", async () => {
    // Clerk returns null once a device has been offline past the token's
    // 60-second life. Sending anyway sends the request as nobody.
    token.value = null;
    const { database, complete } = queueOf(CHECK);
    await expect(new SupabaseConnector().uploadData(database)).rejects.toThrow();
    expect(calls.update).toBe(0);
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps the write queued on a 401 carrying 42501", async () => {
    // The response that deleted a night's checklist answers.
    reply.value = {
      status: 401,
      error: { code: "42501", message: "permission denied for table checklist_instance_items" },
    };
    const { database, complete } = queueOf(CHECK);
    await expect(new SupabaseConnector().uploadData(database)).rejects.toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps the write queued on 401 PGRST303", async () => {
    reply.value = { status: 401, error: { code: "PGRST303", message: "JWT expired" } };
    const { database, complete } = queueOf(CHECK);
    await expect(new SupabaseConnector().uploadData(database)).rejects.toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });

  it("still discards a 403 / 42501 sent with a token", async () => {
    // A genuine refusal must not block every write queued behind it.
    reply.value = { status: 403, error: { code: "42501", message: "row-level security" } };
    const { database, complete } = queueOf(CHECK);
    await new SupabaseConnector().uploadData(database);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("still discards a constraint violation (23505)", async () => {
    reply.value = { status: 409, error: { code: "23505", message: "duplicate key" } };
    const { database, complete } = queueOf(CHECK);
    await new SupabaseConnector().uploadData(database);
    expect(complete).toHaveBeenCalledOnce();
  });
});
