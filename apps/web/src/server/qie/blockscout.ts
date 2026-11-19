import type { Address } from "viem";
import { z } from "zod";
import { activeChain } from "@/lib/chain/chains";

// Blockscout REST API (v2) on the QIE explorers. Verified on 19 Nov 2026:
// - GET /api/v2/stats returns `transactions_today` as a decimal string.
// - The address list endpoints page newest first and accept the previous page's cursor (`block_number`, `index`)
//   as query parameters. Passing `block_number=N&index=0` therefore returns only items strictly before block N,
//   which answers "did this address do anything before its first Showmark interaction" in one request per list.

const TIMEOUT_MS = 8_000;

export function explorerApiBase(): string {
  const url = activeChain.blockExplorers?.default.url;
  if (!url) throw new Error("The active chain has no explorer URL");
  return `${url.replace(/\/$/, "")}/api/v2`;
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Explorer answered ${response.status} for ${new URL(url).pathname}`);
  return response.json();
}

const statsSchema = z.object({ transactions_today: z.union([z.string(), z.number()]).nullable().optional() });
const pageSchema = z.object({ items: z.array(z.unknown()) });

/** Transactions the whole chain processed today, as the explorer reports it. Null when the explorer has no number. */
export async function chainTransactionsToday(fetchImpl: typeof fetch = fetch, base = explorerApiBase()): Promise<number | null> {
  const stats = statsSchema.parse(await getJson(`${base}/stats`, fetchImpl));
  if (stats.transactions_today === null || stats.transactions_today === undefined) return null;
  const n = Number(stats.transactions_today);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when the address sent or received a transaction, a token transfer or an internal transfer in any block
 * before `block`. Used to count wallets whose first on-chain activity was a Showmark interaction.
 */
export async function hadActivityBefore(address: Address, block: bigint, fetchImpl: typeof fetch = fetch, base = explorerApiBase()): Promise<boolean> {
  const cursor = `block_number=${block}&index=0`;
  const lists = [
    `${base}/addresses/${address}/transactions?${cursor}`,
    `${base}/addresses/${address}/token-transfers?${cursor}`,
    `${base}/addresses/${address}/internal-transactions?${cursor}&transaction_index=0`,
  ];
  for (const url of lists) {
    const page = pageSchema.parse(await getJson(url, fetchImpl));
    if (page.items.length > 0) return true;
  }
  return false;
}
