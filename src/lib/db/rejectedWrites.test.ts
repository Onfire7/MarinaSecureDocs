import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissRejectedWrites,
  listRejectedWrites,
  recordRejectedWrite,
  setRejectedWriteStorage,
} from "./rejectedWrites";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("rejectedWrites", () => {
  beforeEach(() => setRejectedWriteStorage(memoryStorage()));

  it("keeps a rejection until it is dismissed", () => {
    recordRejectedWrite({ table: "check_ins", op: "PUT", code: "23505", message: "duplicate key" });
    expect(listRejectedWrites()).toHaveLength(1);
    expect(listRejectedWrites()[0]).toMatchObject({ table: "check_ins", code: "23505" });
    dismissRejectedWrites();
    expect(listRejectedWrites()).toHaveLength(0);
  });

  it("survives a reload, because it lives in storage and not in memory", () => {
    const storage = memoryStorage();
    setRejectedWriteStorage(storage);
    recordRejectedWrite({ table: "tickets", op: "PATCH", code: "42501", message: "rls" });
    setRejectedWriteStorage(storage); // a fresh module would read the same storage
    expect(listRejectedWrites()).toHaveLength(1);
  });

  it("does not throw when storage is unavailable or corrupt", () => {
    const storage = memoryStorage();
    storage.setItem("marinasecure.rejectedWrites", "{not json");
    setRejectedWriteStorage(storage);
    expect(listRejectedWrites()).toEqual([]);
    setRejectedWriteStorage(null);
    expect(() =>
      recordRejectedWrite({ table: "x", op: "PUT", code: "23505", message: "m" }),
    ).not.toThrow();
  });
});
