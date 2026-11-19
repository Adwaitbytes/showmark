import type { Chain, Hex } from "viem";

// Plain objects rather than defineChain so the published declarations name no viem-internal types.

/** QIE mainnet. Five public RPC endpoints, Blockscout explorer. */
export const qieMainnet = {
  id: 1990,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://rpc1mainnet.qie.digital",
        "https://rpc2mainnet.qie.digital",
        "https://rpc3mainnet.qie.digital",
        "https://rpc4mainnet.qie.digital",
        "https://rpc5mainnet.qie.digital",
      ],
    },
  },
  blockExplorers: {
    default: { name: "QIE Explorer", url: "https://mainnet.qie.digital", apiUrl: "https://mainnet.qie.digital/api" },
  },
} as const satisfies Chain;

/** QIE testnet. */
export const qieTestnet = {
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc1testnet.qie.digital"] },
  },
  blockExplorers: {
    default: { name: "QIE Testnet Explorer", url: "https://testnet.qie.digital", apiUrl: "https://testnet.qie.digital/api" },
  },
  testnet: true,
} as const satisfies Chain;

export type SupportedChainId = typeof qieMainnet.id | typeof qieTestnet.id;

export const showmarkChains: Readonly<Record<SupportedChainId, Chain>> = {
  [qieMainnet.id]: qieMainnet,
  [qieTestnet.id]: qieTestnet,
};

export function isSupportedChainId(id: number): id is SupportedChainId {
  return id === qieMainnet.id || id === qieTestnet.id;
}

/** Explorer link for a transaction. Works for any chain that declares a default block explorer. */
export function explorerTxUrl(chain: Chain, hash: Hex): string | null {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : null;
}

/** Explorer link for an address or contract. */
export function explorerAddressUrl(chain: Chain, address: string): string | null {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base.replace(/\/$/, "")}/address/${address}` : null;
}
