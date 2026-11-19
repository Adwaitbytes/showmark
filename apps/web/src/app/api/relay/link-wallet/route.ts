import type { NextRequest } from "next/server";
import { getDatabase } from "@/server/db/client";
import { relayLimits } from "@/server/env";
import { RELAY_ERRORS } from "@/server/errors";
import { clientIp, enforceLimit, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/kv";
import { log } from "@/server/log";
import { pendingFor } from "@/server/payouts";
import { relayerDeps } from "@/server/relayer";
import { relayLinkWallet } from "@/server/relayer/actions";
import type { SettleItem } from "@/server/relayer/settle";
import { linkWalletSchema } from "@/server/schemas";

export const maxDuration = 30;

/** Links a guest pass to a QIE Wallet with both signatures, then settles rewards that were waiting for a QIE ID. */
export async function POST(request: NextRequest): Promise<Response> {
  return handle("relay.link-wallet", async () => {
    const limits = relayLimits();
    await enforceLimit(rateLimiter("link-ip", limits.perIpPerMinute, "1 m"), clientIp(request), RELAY_ERRORS.rateLimitedIp);
    const body = await readJson(request, linkWalletSchema);
    await enforceLimit(rateLimiter("link-pass", limits.perPassPerMinute, "1 m"), body.pass.toLowerCase(), RELAY_ERRORS.rateLimitedPass);

    let waiting: SettleItem[] = [];
    try {
      const pending = await pendingFor(getDatabase().db, body.pass.toLowerCase());
      waiting = pending
        .filter((p) => p.reason === "NeedsQieId")
        .map((p) => ({ campaignId: BigInt(p.campaignId), eventId: BigInt(p.eventId), attendee: body.pass }));
    } catch (error) {
      // Linking must not wait on the index; the cron settles anything this misses.
      log.warn("relay.link_pending_lookup_failed", { pass: body.pass, error });
    }

    const txHash = await relayLinkWallet(relayerDeps(), body, waiting);
    return json({ txHash });
  });
}
