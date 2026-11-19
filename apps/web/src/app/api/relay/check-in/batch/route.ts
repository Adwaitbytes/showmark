import type { NextRequest } from "next/server";
import type { Hex } from "@/lib/api/types";
import { getDatabase } from "@/server/db/client";
import { relayLimits } from "@/server/env";
import { AppError, checkInStatusCopy, RELAY_ERRORS, type ErrorCopy } from "@/server/errors";
import { clientIp, enforceLimit, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/kv";
import { log } from "@/server/log";
import { relayerDeps } from "@/server/relayer";
import { recordDoorQueue } from "@/server/relayer/door-queue";
import { relayCheckIns, simulateCheckIns } from "@/server/relayer/queue";
import { checkInBatchSchema } from "@/server/schemas";

export const maxDuration = 30;

interface BatchResponse {
  /** The checkInBatch transaction, or null when nothing in the batch needed sending. */
  txHash: Hex | null;
  accepted: number;
  rejected: ({ index: number } & ErrorCopy)[];
}

/**
 * The door-scans-you offline queue: up to 50 attestations from one door device. Items the registry would reject
 * (for example already present after a resend) come back in `rejected` with copy; the rest go out together.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handle("relay.check-in.batch", async () => {
    await enforceLimit(rateLimiter("checkin-batch-ip", relayLimits().perIpPerMinute, "1 m"), clientIp(request), RELAY_ERRORS.rateLimitedIp);
    const { items } = await readJson(request, checkInBatchSchema);

    try {
      await recordDoorQueue(getDatabase().db, items, new Date());
    } catch (error) {
      // The audit row is a convenience; the attestation itself is what matters, so relaying continues.
      log.warn("relay.door_queue_record_failed", { items: items.length, error });
    }

    const deps = relayerDeps();
    const statuses = await simulateCheckIns(deps.chain, items);
    const rejected: BatchResponse["rejected"] = [];
    const accepted = items.filter((_, i) => {
      if (statuses[i] === 0) return true;
      rejected.push({ index: i, ...checkInStatusCopy(statuses[i]) });
      return false;
    });
    if (accepted.length === 0) return json({ txHash: null, accepted: 0, rejected } satisfies BatchResponse);

    const results = await relayCheckIns(deps, accepted);
    let txHash: Hex | null = null;
    let sentCount = 0;
    results.forEach((result, i) => {
      const index = items.indexOf(accepted[i]);
      if (result.ok) {
        txHash ??= result.txHash;
        sentCount += 1;
      } else if ("status" in result) {
        rejected.push({ index, ...checkInStatusCopy(result.status) });
      } else {
        rejected.push({ index, ...RELAY_ERRORS.sendFailed });
      }
    });
    if (sentCount === 0 && rejected.every((r) => r.code === RELAY_ERRORS.sendFailed.code)) throw new AppError(502, RELAY_ERRORS.sendFailed);
    return json({ txHash, accepted: sentCount, rejected: rejected.sort((a, b) => a.index - b.index) } satisfies BatchResponse);
  });
}
