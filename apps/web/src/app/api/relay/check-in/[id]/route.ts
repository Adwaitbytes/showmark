import type { NextRequest } from "next/server";
import type { RelayQueued, RelaySubmitted } from "@/lib/api/types";
import { AppError, checkInStatusCopy, READ_ERRORS, RELAY_ERRORS } from "@/server/errors";
import { handle, json } from "@/server/http";
import { relayerDeps } from "@/server/relayer";
import { readResult } from "@/server/relayer/queue";

/** Status of a check-in that POST /api/relay/check-in answered as queued. Results are kept for 10 minutes. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/relay/check-in/[id]">): Promise<Response> {
  return handle("relay.check-in.status", async () => {
    const { id } = await ctx.params;
    if (!/^[0-9a-f]{24}$/.test(id)) throw new AppError(400, READ_ERRORS.invalidId);
    const result = await readResult(relayerDeps(), id);
    if (result === null) return json({ id, status: "queued" } satisfies RelayQueued, { status: 202 });
    if (!result.ok) {
      if ("status" in result) throw new AppError(422, checkInStatusCopy(result.status));
      throw new AppError(502, RELAY_ERRORS.sendFailed);
    }
    return json({ txHash: result.txHash, status: "submitted" } satisfies RelaySubmitted);
  });
}
