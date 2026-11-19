import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { derivePassKey, ensurePass, loadPass, passDerivationMessage, type PassStorage } from "./pass";
import { discoverWallets, QIE_WALLET_RDNS, type Eip1193Provider } from "./eip6963";
import { connect, getSnapshot, resetWalletStoreForTests } from "./wallet-store";

class MemoryStorage implements PassStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

type Listener = (...args: unknown[]) => void;

function fakeProvider(handlers: Record<string, (params: unknown) => unknown>) {
  const listeners = new Map<string, Listener>();
  const provider: Eip1193Provider & { emit(event: string, ...args: unknown[]): void } = {
    async request({ method, params }) {
      const h = handlers[method];
      if (!h) throw Object.assign(new Error(`unhandled ${method}`), { code: -32601 });
      return h(params);
    },
    on(event, listener) { listeners.set(event, listener); },
    removeListener(event) { listeners.delete(event); },
    emit(event, ...args) { listeners.get(event)?.(...args); },
  };
  return provider;
}

function installWindow(announce: { rdns: string; provider: Eip1193Provider }[], qie?: Eip1193Provider) {
  const target = new EventTarget();
  const win = Object.assign(target, {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    localStorage: new MemoryStorage(),
    location: { reload: vi.fn() },
    qie,
  });
  target.addEventListener("eip6963:requestProvider", () => {
    for (const [i, a] of announce.entries()) {
      const event = new Event("eip6963:announceProvider") as Event & { detail: unknown };
      Object.defineProperty(event, "detail", { value: { info: { uuid: `u${i}`, name: a.rdns, icon: "", rdns: a.rdns }, provider: a.provider } });
      target.dispatchEvent(event);
    }
  });
  vi.stubGlobal("window", win);
  return win;
}

const ACCOUNT = "0xa8c849c243ba940102d2deb99971e4c713411926";

beforeEach(() => resetWalletStoreForTests());
afterEach(() => vi.unstubAllGlobals());

describe("pass key", () => {
  it("creates once and then reuses the same pass", () => {
    const storage = new MemoryStorage();
    const first = ensurePass(storage);
    expect(ensurePass(storage).address).toBe(first.address);
    expect(loadPass(storage)?.address).toBe(first.address);
  });

  it("ignores corrupted storage instead of throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem("showmark.pass.v1", "{not json");
    expect(loadPass(storage)).toBeNull();
  });

  it("derives the same valid key from the same signature", () => {
    const sig = `0x${"11".repeat(64)}1b` as const;
    expect(derivePassKey(sig)).toBe(derivePassKey(sig));
    expect(privateKeyToAccount(derivePassKey(sig)).address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(passDerivationMessage(ACCOUNT)).toContain(ACCOUNT);
  });
});

describe("EIP-6963 discovery", () => {
  it("puts QIE Wallet first even when it announces last", async () => {
    installWindow([
      { rdns: "io.metamask", provider: fakeProvider({}) },
      { rdns: QIE_WALLET_RDNS, provider: fakeProvider({}) },
    ]);
    const wallets = await discoverWallets(10);
    expect(wallets.map((w) => w.info.rdns)).toEqual([QIE_WALLET_RDNS, "io.metamask"]);
  });

  it("falls back to window.qie when QIE Wallet does not announce", async () => {
    installWindow([], fakeProvider({}));
    const wallets = await discoverWallets(10);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].info.rdns).toBe(QIE_WALLET_RDNS);
  });
});

describe("connect", () => {
  it("adds the chain when the wallet does not know it, then connects", async () => {
    let chain = "0x1";
    const added = vi.fn();
    const provider = fakeProvider({
      eth_requestAccounts: () => [ACCOUNT],
      eth_chainId: () => chain,
      wallet_switchEthereumChain: () => { throw Object.assign(new Error("unknown chain"), { code: 4902 }); },
      wallet_addEthereumChain: (params) => { added(params); chain = "0x7bf"; return null; },
    });
    installWindow([{ rdns: QIE_WALLET_RDNS, provider }]);
    const account = await connect();
    expect(account?.toLowerCase()).toBe(ACCOUNT);
    expect(added).toHaveBeenCalledOnce();
    expect(getSnapshot().status).toBe("connected");
  });

  it("treats an empty accountsChanged as a disconnect", async () => {
    const provider = fakeProvider({ eth_requestAccounts: () => [ACCOUNT], eth_chainId: () => "0x7bf" });
    installWindow([{ rdns: QIE_WALLET_RDNS, provider }]);
    await connect();
    provider.emit("accountsChanged", []);
    expect(getSnapshot().status).toBe("idle");
    expect(getSnapshot().account).toBeNull();
  });

  it("explains a declined request in plain words", async () => {
    const provider = fakeProvider({ eth_requestAccounts: () => { throw Object.assign(new Error("no"), { code: 4001 }); } });
    installWindow([{ rdns: QIE_WALLET_RDNS, provider }]);
    expect(await connect()).toBeNull();
    expect(getSnapshot().error?.code).toBe("rejected");
  });

  it("says how to find a wallet when none is installed", async () => {
    installWindow([]);
    expect(await connect()).toBeNull();
    expect(getSnapshot().error?.code).toBe("no-wallet");
  });
});
