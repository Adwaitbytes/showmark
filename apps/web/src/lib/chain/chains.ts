import { defineChain, type Chain } from "viem";

export const qieMainnet = defineChain({
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
});

export const qieTestnet = defineChain({
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
});

export type SupportedChainId = typeof qieMainnet.id | typeof qieTestnet.id;

const chainsById: Record<SupportedChainId, Chain> = {
  [qieMainnet.id]: qieMainnet,
  [qieTestnet.id]: qieTestnet,
};

function parseChainId(raw: string | undefined): SupportedChainId {
  const id = Number(raw ?? qieTestnet.id);
  if (id !== qieMainnet.id && id !== qieTestnet.id) {
    throw new Error(`NEXT_PUBLIC_CHAIN_ID must be 1990 or 1983, got ${raw}`);
  }
  return id;
}

/** The single chain this deployment talks to, chosen at build time. */
export const activeChainId: SupportedChainId = parseChainId(process.env.NEXT_PUBLIC_CHAIN_ID);
export const activeChain: Chain = chainsById[activeChainId];

export function explorerTx(hash: string): string {
  return `${activeChain.blockExplorers?.default.url}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${activeChain.blockExplorers?.default.url}/address/${address}`;
}
