import { isAddressEqual, parseEventLogs, TransactionReceiptNotFoundError, type Hex } from "viem";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { TxStatus } from "@/lib/api/types";
import { registryAbi } from "@/lib/chain/abi";
import { chainContext } from "@/server/chain";
import { AppError, checkInStatusCopy, COMMON_ERRORS, READ_ERRORS } from "@/server/errors";
import { CACHE, handle, json, parseWith } from "@/server/http";
import { addressSchema, idString, searchParamsObject, txHashSchema } from "@/server/schemas";

const querySchema = z.object({ event: idString.optional(), attendee: addressSchema.optional() }).refine((q) => (q.event === undefined) === (q.attendee === undefined), {
  message: "give both event and attendee, or neither",
});

/**
 * Receipt status for a relayed transaction. QIE has instant finality, so a mined result never changes and is
 * cached for a year; a pending answer is never cached. A hash the node has not seen yet also reads as pending,
 * because the relayer may have sent it through a different RPC endpoint a moment ago.
 *
 * With `?event=&attendee=` the answer is about that attendee's item inside a checkInBatch: a batch can succeed
 * while one item is rejected, so the CheckedIn or CheckInRejected log decides, and a rejected item reads
 * "reverted" so no stamp is ever shown for it.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/tx/[hash]">): Promise<Response> {
  return handle("tx", async () => {
    const parsed = txHashSchema.safeParse((await ctx.params).hash);
    if (!parsed.success) throw new AppError(400, READ_ERRORS.invalidTxHash);
    const hash: Hex = parsed.data;
    const query = parseWith(querySchema, searchParamsObject(request.nextUrl.searchParams));
    const chain = chainContext();
    let receipt;
    try {
      receipt = await chain.client.getTransactionReceipt({ hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return json({ status: "pending" } satisfies TxStatus);
      throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
    }
    const body: TxStatus = { status: receipt.status === "success" ? "success" : "reverted", blockNumber: receipt.blockNumber.toString() };

    if (query.event !== undefined && query.attendee !== undefined) {
      const { event, attendee } = query;
      const item = parseEventLogs({ abi: registryAbi, logs: receipt.logs, eventName: ["CheckedIn", "CheckInRejected"] }).find(
        (l) => isAddressEqual(l.address, chain.registry) && l.args.eventId === event && isAddressEqual(l.args.attendee, attendee),
      );
      if (item?.eventName === "CheckedIn") {
        body.checkIn = { recorded: true, status: 0 };
      } else {
        // -1: this transaction holds no result for the attendee (for example a different batch).
        const status = item?.eventName === "CheckInRejected" ? item.args.status : -1;
        body.status = "reverted";
        body.checkIn = { recorded: false, status, error: checkInStatusCopy(status) };
      }
    }
    return json(body, { cache: CACHE.immutable });
  });
}
