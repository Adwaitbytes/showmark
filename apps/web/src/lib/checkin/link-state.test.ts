import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import type { PassStorage } from "@/lib/wallet/pass";
import { rememberedWallet, rememberLinkedWallet, resolveLinkedWallet } from "./link-state";

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

const PASS = getAddress("0x7ae3b1c9d4f20a8e6b5c3d1f9a2e4b6c8d0f1a3b");
const WALLET = getAddress("0x2f9d41ae7b3c5e8d1a6f0b4c9e2d7a5b3c1e8f06");
const OTHER = getAddress("0x91c4e2b7a3d5f8e1c6a9b0d4e7f2a5c8b1d3e6f9");

describe("link state", () => {
  it("trusts the chain over this phone's memory and the index", () => {
    expect(resolveLinkedWallet(WALLET, null, null)).toBe(WALLET);
    expect(resolveLinkedWallet(null, WALLET, OTHER)).toBeNull();
  });

  it("uses this phone's memory, then the index, while the chain has not answered", () => {
    expect(resolveLinkedWallet(undefined, WALLET, OTHER)).toBe(WALLET);
    expect(resolveLinkedWallet(undefined, null, OTHER)).toBe(OTHER);
    expect(resolveLinkedWallet(undefined, null, null)).toBeNull();
  });

  it("remembers a confirmed link per pass, ignoring case", () => {
    const storage = new MemoryStorage();
    rememberLinkedWallet(PASS, WALLET.toLowerCase() as `0x${string}`, storage);
    expect(rememberedWallet(PASS.toLowerCase() as `0x${string}`, storage)).toBe(WALLET);
    expect(rememberedWallet(OTHER, storage)).toBeNull();
  });
});
