import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ensurePass, loadPass, type PassStorage } from "@/lib/wallet/pass";
import { ensurePassKey, PassStorageError } from "./pass-key";

class MemoryStorage implements PassStorage {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

describe("ensurePassKey", () => {
  it("writes a pass that src/lib/wallet/pass.ts loads as the same account", () => {
    const storage = new MemoryStorage();
    const key = ensurePassKey(storage);
    expect(loadPass(storage)?.address).toBe(privateKeyToAccount(key).address);
    expect(ensurePassKey(storage)).toBe(key);
  });

  it("reuses a pass that src/lib/wallet/pass.ts created", () => {
    const storage = new MemoryStorage();
    const account = ensurePass(storage);
    expect(privateKeyToAccount(ensurePassKey(storage)).address).toBe(account.address);
  });

  it("refuses to sign with a pass the browser will not keep", () => {
    expect(() => ensurePassKey(null)).toThrow(PassStorageError);
    const dropping = new MemoryStorage();
    dropping.setItem = () => undefined;
    expect(() => ensurePassKey(dropping)).toThrow(PassStorageError);
  });
});
