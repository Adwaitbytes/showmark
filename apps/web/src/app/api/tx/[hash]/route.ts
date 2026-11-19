import { TransactionReceiptNotFoundError, type Hex } from "viem";
import type { NextRequest } from "next/server";
import type { TxStatus } from "@/lib/api/types";
import { chainContext } from "@/server/chain";
import { AppError, COMMON_ERRORS, READ_ERRORS } from "@/server/errors";
import { CACHE, handle, json } from "@/server/http";
import { txHashSchema } from "@/server/schemas";

/**
 * Receipt status for a relayed transaction. QIE has instant finality, so a mined result never changes and is
 * cached for a year; a pending answer is never cached. A hash the node has not seen yet also reads as pending,
 * because the relayer may have sent it through a different RPC endpoint a moment ago.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/tx/[hash]">): Promise<Response> {
  return handle("tx", async () => {
    const parsed = txHashSchema.safeParse((await ctx.params).hash);
    if (!parsed.success) throw new AppError(400, READ_ERRORS.invalidTxHash);
    const hash: Hex = parsed.data;
    const { client } = chainContext();
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      const body: TxStatus = { status: receipt.status === "success" ? "success" : "reverted", blockNumber: receipt.blockNumber.toString() };
      return json(body, { cache: CACHE.immutable });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return json({ status: "pending" } satisfies TxStatus);
      throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
    }
  });
}
