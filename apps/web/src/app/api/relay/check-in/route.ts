import type { NextRequest } from "next/server";
import type { RelaySubmitted } from "@/lib/api/types";
import { relayLimits } from "@/server/env";
import { AppError, checkInStatusCopy, RELAY_ERRORS } from "@/server/errors";
import { clientIp, enforceLimit, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/kv";
import { relayerDeps } from "@/server/relayer";
import { relayCheckIns, simulateCheckIns } from "@/server/relayer/queue";
import { checkInDataSchema } from "@/server/schemas";

export const maxDuration = 30;

/** Gasless check-in. Simulated with checkInBatch first, so a rejected check-in costs no gas and gets exact copy. */
export async function POST(request: NextRequest): Promise<Response> {
  return handle("relay.check-in", async () => {
    const limits = relayLimits();
    await enforceLimit(rateLimiter("checkin-ip", limits.perIpPerMinute, "1 m"), clientIp(request), RELAY_ERRORS.rateLimitedIp);
    const item = await readJson(request, checkInDataSchema);
    await enforceLimit(rateLimiter("checkin-pass", limits.perPassPerMinute, "1 m"), item.attendee.toLowerCase(), RELAY_ERRORS.rateLimitedPass);

    const deps = relayerDeps();
    const [status] = await simulateCheckIns(deps.chain, [item]);
    if (status !== 0) throw new AppError(422, checkInStatusCopy(status));

    const [result] = await relayCheckIns(deps, [item]);
    if (!result.ok) {
      if ("status" in result) throw new AppError(422, checkInStatusCopy(result.status));
      throw new AppError(502, RELAY_ERRORS.sendFailed);
    }
    return json({ txHash: result.txHash, status: "submitted" } satisfies RelaySubmitted);
  });
}
