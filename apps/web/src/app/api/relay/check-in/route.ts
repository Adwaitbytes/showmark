import { after, type NextRequest } from "next/server";
import type { RelayQueued, RelaySubmitted } from "@/lib/api/types";
import { relayLimits } from "@/server/env";
import { AppError, checkInStatusCopy, RELAY_ERRORS } from "@/server/errors";
import { clientIp, enforceLimit, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/kv";
import { log } from "@/server/log";
import { relayerDeps } from "@/server/relayer";
import { awaitCheckIns, enqueueCheckIns, flushSettlements } from "@/server/relayer/queue";
import { checkInDataSchema } from "@/server/schemas";

export const maxDuration = 60;

/** How long the request itself waits for a tx hash before answering 202 queued. */
const ANSWER_WITHIN_MS = 3_000;
/** How long this invocation keeps flushing after answering, so a queued check-in never waits for the cron. */
const KEEP_FLUSHING_MS = 40_000;

/**
 * Gasless check-in. The batch flush simulates every item with checkInBatch, so a rejected check-in costs no gas
 * and gets exact copy, and the hash comes back as soon as the transaction is broadcast. During a burst the answer
 * is 202 `{ status: "queued", id }` after about 3 s; poll /api/relay/check-in/{id}. No Postgres on this path.
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

    const deps = relayerDeps();
    const [id] = await enqueueCheckIns(deps, [item]);
    const [result] = await awaitCheckIns(deps, [id], ANSWER_WITHIN_MS);
    log.info("relay.check_in", { eventId: item.eventId, id, outcome: result === null ? "queued" : result.ok ? "sent" : "rejected", rateLimitMs: limitedAt - started, relayMs: Date.now() - limitedAt, totalMs: Date.now() - started });

    if (result === null) {
      // Keep this invocation working on the queue after answering; the cron is the backstop.
      after(async () => {
        try {
          await awaitCheckIns(deps, [id], KEEP_FLUSHING_MS);
          await flushSettlements(deps);
        } catch (error) {
          log.warn("relay.keep_flushing_failed", { id, error });
        }
      });
      return json({ id, status: "queued" } satisfies RelayQueued, { status: 202 });
    }
    if (!result.ok) {
      if ("status" in result) throw new AppError(422, checkInStatusCopy(result.status));
      throw new AppError(502, RELAY_ERRORS.sendFailed);
    }
    return json({ txHash: result.txHash, status: "submitted" } satisfies RelaySubmitted);
  });
}
