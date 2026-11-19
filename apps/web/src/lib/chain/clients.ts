import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { activeChain } from "./chains";

const transports = activeChain.rpcUrls.default.http.map((url) =>
  http(url, { timeout: 8_000, retryCount: 1, batch: { wait: 16 } }),
);

/** Read client with automatic failover across the public QIE RPC endpoints. */
export const publicClient: PublicClient = createPublicClient({
  chain: activeChain,
  transport: fallback(transports, { rank: false, retryCount: 2 }),
});
