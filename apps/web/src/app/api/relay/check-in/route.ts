import type { NextRequest } from "next/server";
import type { RelaySubmitted } from "@/lib/api/types";
import { relayLimits } from "@/server/env";
import { AppError, checkInStatusCopy, RELAY_ERRORS } from "@/server/errors";
import { clientIp, enforceLimit, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/kv";
import { log } from "@/server/log";
import { relayerDeps } from "@/server/relayer";
import { relayCheckIns } from "@/server/relayer/queue";
import { checkInDataSchema } from "@/server/schemas";

export const maxDuration = 30;

/**
 * Gasless check-in. The batch flush simulates every item with checkInBatch, so a rejected check-in costs no gas
 * and gets exact copy, and the answer comes back as soon as the transaction is broadcast (the settlement behind
 * it goes out after the response). No Postgres on this path.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handle("relay.check-in", async () => {
    const started = Date.now();
    const limits = relayLimits();
    const item = await readJson(request, checkInDataSchema);
    // Both limits in parallel: one Redis round trip of latency.
    await Promise.all([
      enforceLimit(rateLimiter("checkin-ip", limits.perIpPerMinute, "1 m"), clientIp(request), RELAY_ERRORS.rateLimitedIp),
      enforceLimit(rateLimiter("checkin-pass", limits.perPassPerMinute, "1 m"), item.attendee.toLowerCase(), RELAY_ERRORS.rateLimitedPass),
    ]);
    const limitedAt = Date.now();

    const [result] = await relayCheckIns(relayerDeps(), [item]);
    log.info("relay.check_in", { eventId: item.eventId, ok: result.ok, rateLimitMs: limitedAt - started, relayMs: Date.now() - limitedAt, totalMs: Date.now() - started });
    if (!result.ok) {
      if ("status" in result) throw new AppError(422, checkInStatusCopy(result.status));
      throw new AppError(502, RELAY_ERRORS.sendFailed);
    }
    return json({ txHash: result.txHash, status: "submitted" } satisfies RelaySubmitted);
  });
}
