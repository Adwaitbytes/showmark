import { zeroAddress } from "viem";
import { aggregatorAbi } from "@/lib/chain/abi";
import { chainContext, type ChainContext } from "../chain";
import { AppError, COMMON_ERRORS } from "../errors";

export interface QiePrice {
  /** USD per QIE. */
  usd: number;
  updatedAt: Date;
}

const CACHE_MS = 60_000;
let cached: { chainId: number; at: number; value: QiePrice | null } | null = null;

/**
 * QIE/USD from the on-chain oracle (8 decimals on mainnet). Null when the network has no oracle configured or the
 * feed has never answered with a positive price. The feed updates on deviation, so `updatedAt` can be hours old;
 * callers that show a USD figure show this time next to it.
 */
export async function qieUsdPrice(ctx: ChainContext = chainContext()): Promise<QiePrice | null> {
  if (cached && cached.chainId === ctx.chainId && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (ctx.oracle === zeroAddress) return null;
  let value: QiePrice | null;
  try {
    const [round, decimals] = await Promise.all([
      ctx.client.readContract({ address: ctx.oracle, abi: aggregatorAbi, functionName: "latestRoundData" }),
      ctx.client.readContract({ address: ctx.oracle, abi: aggregatorAbi, functionName: "decimals" }),
    ]);
    const [, answer, , updatedAt] = round;
    value = answer > 0n ? { usd: Number(answer) / 10 ** decimals, updatedAt: new Date(Number(updatedAt) * 1000) } : null;
  } catch (error) {
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }
  cached = { chainId: ctx.chainId, at: Date.now(), value };
  return value;
}
