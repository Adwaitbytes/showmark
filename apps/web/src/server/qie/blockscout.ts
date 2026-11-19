import type { Address } from "viem";
import { z } from "zod";
import { activeChain } from "@/lib/chain/chains";
import { READ_TIMEOUT_MS } from "../timeout";

// Blockscout REST API (v2) on the QIE explorers. Verified on 19 Nov 2026:
// - GET /api/v2/stats returns `transactions_today` as a decimal string.
// - The address list endpoints page newest first and accept the previous page's cursor (`block_number`, `index`)
//   as query parameters. Passing `block_number=N&index=0` therefore returns only items strictly before block N,
//   which answers "did this address do anything before its first Showmark interaction" in one request per list.

// The same deadline as chain reads on the page path.
const TIMEOUT_MS = READ_TIMEOUT_MS;

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

const chartSchema = z.object({ chart_data: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), transaction_count: z.union([z.number(), z.string()]) })) });
const pageSchema = z.object({ items: z.array(z.unknown()) });

export interface ChainDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  transactions: number;
}

/**
 * The chain's transaction count for its latest complete UTC day, from /api/v2/stats/charts/transactions.
 * (The `transactions_today` field of /api/v2/stats repeats this same last complete day, not today.)
 */
export async function chainLatestDay(fetchImpl: typeof fetch = fetch, base = explorerApiBase()): Promise<ChainDay | null> {
  const chart = chartSchema.parse(await getJson(`${base}/stats/charts/transactions`, fetchImpl));
  const latest = [...chart.chart_data].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) return null;
  const transactions = Number(latest.transaction_count);
  return Number.isFinite(transactions) ? { date: latest.date, transactions } : null;
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
