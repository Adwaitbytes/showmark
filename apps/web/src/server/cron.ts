import { timingSafeEqual } from "node:crypto";
import { getDatabase } from "./db/client";
import { cronSecret, relayerPrivateKey } from "./env";
import { AppError, isAppError, READ_ERRORS } from "./errors";
import { refreshProfiles } from "./indexer/profiles";
import { syncForCron } from "./indexer/sync";
import { log } from "./log";
import { relayerDeps } from "./relayer";
import { relaySettlements } from "./relayer/actions";
import { drainQueue } from "./relayer/queue";
import { retryableSettlements } from "./relayer/retry";

/** Accepts `Authorization: Bearer <CRON_SECRET>`, the header Vercel Cron sends, compared in constant time. */
export function assertCronAuthorized(header: string | null): void {
  const secret = cronSecret();
  if (!secret) {
    throw new AppError(503, { code: "cron_not_configured", message: "Scheduled sync is switched off on this server.", action: "Set CRON_SECRET and redeploy." });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AppError(401, READ_ERRORS.cronUnauthorized);
}

type StepResult<T> = { ok: true; result: T } | { ok: false; code: string };

async function step<T>(name: string, fn: () => Promise<T>): Promise<StepResult<T>> {
  try {
    return { ok: true, result: await fn() };
  } catch (error) {
    log.error("cron.step_failed", { step: name, error });
    return { ok: false, code: isAppError(error) ? error.copy.code : "internal_error" };
  }
}

const SYNC_BUDGET_MS = 40_000;

/**
 * One scheduled pass: index to head, fill in profile facts, send anything left in the check-in queue, and retry
 * settlements that can now pay. Each step runs even if an earlier one failed, and reports its own outcome.
 */
export async function runCron() {
  const sync = await step("sync", () => syncForCron(SYNC_BUDGET_MS));
  const profiles = await step("profiles", () => refreshProfiles(20));
  const relayerConfigured = relayerPrivateKey() !== null;
  const queue = relayerConfigured ? await step("queue", () => drainQueue(relayerDeps())) : null;
  const settlements = relayerConfigured
    ? await step("settlements", async () => {
        const items = await retryableSettlements(getDatabase().db, 100);
        const txHash = await relaySettlements(relayerDeps(), items);
        return { items: items.length, txHash };
      })
    : null;
  return { ok: sync.ok, sync, profiles, queue, settlements };
}
