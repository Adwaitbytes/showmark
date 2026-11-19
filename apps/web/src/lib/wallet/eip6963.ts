// EIP-6963 multi-wallet discovery. QIE Wallet announces itself with rdns "me.qiewallet".
// We never trust window.ethereum or isMetaMask: QIE Wallet sets isMetaMask = true as well.

export const QIE_WALLET_RDNS = "me.qiewallet";

export interface Eip1193RequestArgs {
  method: string;
  params?: readonly unknown[] | object;
}

export interface Eip1193Provider {
  request(args: Eip1193RequestArgs): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface DiscoveredWallet {
  info: WalletInfo;
  provider: Eip1193Provider;
}

interface AnnounceEvent extends Event {
  detail: { info: WalletInfo; provider: Eip1193Provider };
}

function isAnnounceEvent(event: Event): event is AnnounceEvent {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== "object" || detail === null) return false;
  const d = detail as { info?: Partial<WalletInfo>; provider?: { request?: unknown } };
  return typeof d.info?.rdns === "string" && typeof d.info?.uuid === "string" && typeof d.provider?.request === "function";
}

interface WindowWithQie {
  qie?: Eip1193Provider;
}

/**
 * Collects wallets that answer an EIP-6963 request within `waitMs`.
 * Falls back to `window.qie` when QIE Wallet is installed but did not announce.
 * QIE Wallet is always first in the returned list.
 */
export function discoverWallets(waitMs = 400): Promise<DiscoveredWallet[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  const found = new Map<string, DiscoveredWallet>();

  const onAnnounce = (event: Event) => {
    if (!isAnnounceEvent(event)) return;
    const { info, provider } = event.detail;
    if (!found.has(info.uuid)) found.set(info.uuid, { info, provider });
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  return new Promise((resolve) => {
    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const wallets = [...found.values()];
      const legacyQie = (window as unknown as WindowWithQie).qie;
      if (!wallets.some((w) => w.info.rdns === QIE_WALLET_RDNS) && legacyQie && typeof legacyQie.request === "function") {
        wallets.push({
          info: { uuid: "window.qie", name: "QIE Wallet", icon: "", rdns: QIE_WALLET_RDNS },
          provider: legacyQie,
        });
      }
      wallets.sort((a, b) => Number(b.info.rdns === QIE_WALLET_RDNS) - Number(a.info.rdns === QIE_WALLET_RDNS));
      resolve(wallets);
    }, waitMs);
  });
}
