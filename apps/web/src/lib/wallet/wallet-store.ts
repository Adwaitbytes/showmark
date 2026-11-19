import { createWalletClient, custom, getAddress, isAddress, numberToHex, type Address, type WalletClient } from "viem";
import { activeChain, activeChainId } from "../chain/chains";
import { discoverWallets, QIE_WALLET_RDNS, type DiscoveredWallet, type Eip1193Provider } from "./eip6963";

export type WalletStatus = "idle" | "discovering" | "connecting" | "connected" | "wrong-chain" | "error";

export interface WalletError {
  code: "no-wallet" | "rejected" | "testnet-hidden" | "chain-switch-failed" | "unknown";
  message: string;
  action: string;
}

export interface WalletState {
  status: WalletStatus;
  wallets: DiscoveredWallet[];
  selected: DiscoveredWallet | null;
  account: Address | null;
  chainId: number | null;
  error: WalletError | null;
}

const LAST_WALLET_KEY = "showmark.wallet.last";

const initialState: WalletState = {
  status: "idle",
  wallets: [],
  selected: null,
  account: null,
  chainId: null,
  error: null,
};

let state: WalletState = initialState;
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;

function setState(patch: Partial<WalletState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): WalletState {
  return state;
}

export function getServerSnapshot(): WalletState {
  return initialState;
}

interface ProviderRpcError {
  code?: number;
  message?: string;
}

function rpcCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as ProviderRpcError).code;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

export function toWalletError(error: unknown): WalletError {
  const code = rpcCode(error);
  if (code === 4001) {
    return { code: "rejected", message: "The request was declined in your wallet.", action: "Try again and approve it in QIE Wallet." };
  }
  if (code === 4902 && activeChain.testnet) {
    return {
      code: "testnet-hidden",
      message: "QIE Wallet does not show the QIE testnet yet.",
      action: "In QIE Wallet open settings, turn on testnet networks, then try again.",
    };
  }
  return {
    code: "unknown",
    message: "Your wallet returned an error we did not expect.",
    action: "Reload the page and try again. If it keeps happening, reopen QIE Wallet.",
  };
}

function parseChainId(raw: unknown): number | null {
  if (typeof raw === "string") return raw.startsWith("0x") ? Number.parseInt(raw, 16) : Number(raw);
  if (typeof raw === "number") return raw;
  return null;
}

function parseAccounts(raw: unknown): Address[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is string => typeof a === "string" && isAddress(a)).map((a) => getAddress(a));
}

function attach(provider: Eip1193Provider): void {
  detach?.();
  const onAccounts = (...args: unknown[]) => {
    const accounts = parseAccounts(args[0]);
    // QIE Wallet has no disconnect event; an empty account list means the site was disconnected.
    if (accounts.length === 0) {
      disconnect();
      return;
    }
    setState({ account: accounts[0] });
  };
  const onChain = () => {
    // Recommended by the QIE Wallet guide: reload rather than patch every piece of chain-dependent state.
    window.location.reload();
  };
  provider.on?.("accountsChanged", onAccounts);
  provider.on?.("chainChanged", onChain);
  detach = () => {
    provider.removeListener?.("accountsChanged", onAccounts);
    provider.removeListener?.("chainChanged", onChain);
  };
}

export async function refreshWallets(): Promise<DiscoveredWallet[]> {
  setState({ status: state.status === "connected" ? "connected" : "discovering" });
  const wallets = await discoverWallets();
  setState({ wallets, status: state.status === "discovering" ? "idle" : state.status });
  return wallets;
}

function chainParams() {
  return {
    chainId: numberToHex(activeChainId),
    chainName: activeChain.name,
    nativeCurrency: activeChain.nativeCurrency,
    rpcUrls: [...activeChain.rpcUrls.default.http],
    blockExplorerUrls: activeChain.blockExplorers ? [activeChain.blockExplorers.default.url] : [],
  };
}

export async function ensureChain(provider: Eip1193Provider): Promise<void> {
  const current = parseChainId(await provider.request({ method: "eth_chainId" }));
  if (current === activeChainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(activeChainId) }] });
  } catch (error) {
    if (rpcCode(error) !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [chainParams()] });
  }
}

/** Connects the chosen wallet, preferring QIE Wallet, and switches it to the active QIE chain. */
export async function connect(preferred?: DiscoveredWallet): Promise<Address | null> {
  setState({ status: "connecting", error: null });
  try {
    const wallets = state.wallets.length > 0 ? state.wallets : await refreshWallets();
    const wallet = preferred ?? wallets.find((w) => w.info.rdns === QIE_WALLET_RDNS) ?? wallets[0];
    if (!wallet) {
      setState({
        status: "error",
        error: {
          code: "no-wallet",
          message: "No wallet was found in this browser.",
          action: "Install QIE Wallet from qiewallet.me, then reload this page.",
        },
      });
      return null;
    }
    const accounts = parseAccounts(await wallet.provider.request({ method: "eth_requestAccounts" }));
    if (accounts.length === 0) throw Object.assign(new Error("No account"), { code: 4001 });
    try {
      await ensureChain(wallet.provider);
    } catch (error) {
      const walletError = toWalletError(error);
      setState({
        status: "wrong-chain",
        selected: wallet,
        account: accounts[0],
        error: walletError.code === "unknown"
          ? { code: "chain-switch-failed", message: `Your wallet is on another network.`, action: `Switch QIE Wallet to ${activeChain.name} and try again.` }
          : walletError,
      });
      return accounts[0];
    }
    attach(wallet.provider);
    setState({ status: "connected", selected: wallet, account: accounts[0], chainId: activeChainId });
    try {
      window.localStorage.setItem(LAST_WALLET_KEY, wallet.info.rdns);
    } catch {
      // Storage is optional here; reconnecting just asks again.
    }
    return accounts[0];
  } catch (error) {
    setState({ status: "error", error: toWalletError(error) });
    return null;
  }
}

/** Restores a previous connection without prompting, using eth_accounts. */
export async function reconnect(): Promise<void> {
  let last: string | null = null;
  try {
    last = window.localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return;
  }
  if (!last) return;
  const wallets = await refreshWallets();
  const wallet = wallets.find((w) => w.info.rdns === last);
  if (!wallet) return;
  const accounts = parseAccounts(await wallet.provider.request({ method: "eth_accounts" }));
  if (accounts.length === 0) return;
  const chainId = parseChainId(await wallet.provider.request({ method: "eth_chainId" }));
  attach(wallet.provider);
  setState({
    status: chainId === activeChainId ? "connected" : "wrong-chain",
    selected: wallet,
    account: accounts[0],
    chainId,
  });
}

export function disconnect(): void {
  detach?.();
  detach = null;
  try {
    window.localStorage.removeItem(LAST_WALLET_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
  setState({ status: "idle", selected: null, account: null, chainId: null, error: null });
}

/** A viem wallet client bound to the connected wallet, for typed-data signatures and transactions. */
export function walletClient(): WalletClient | null {
  if (state.status !== "connected" || !state.selected || !state.account) return null;
  return createWalletClient({ account: state.account, chain: activeChain, transport: custom(state.selected.provider) });
}

/** Test hook: resets module state between tests. */
export function resetWalletStoreForTests(): void {
  detach?.();
  detach = null;
  state = initialState;
  listeners.clear();
}
