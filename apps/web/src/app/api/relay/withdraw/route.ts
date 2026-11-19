import type { NextRequest } from "next/server";
import { relayLimits } from "@/server/env";
import { RELAY_ERRORS } from "@/server/errors";
import { clientIp, enforceLimit, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/kv";
import { relayerDeps } from "@/server/relayer";
import { relayWithdraw } from "@/server/relayer/actions";
import { withdrawSchema } from "@/server/schemas";

export const maxDuration = 30;

/** Gasless withdrawal. Anyone may trigger it; the vault always pays the account's linked wallet or the account. */
export async function POST(request: NextRequest): Promise<Response> {
  return handle("relay.withdraw", async () => {
    const limits = relayLimits();
    await enforceLimit(rateLimiter("withdraw-ip", limits.perIpPerMinute, "1 m"), clientIp(request), RELAY_ERRORS.rateLimitedIp);
    const body = await readJson(request, withdrawSchema);
    await enforceLimit(rateLimiter("withdraw-account", limits.perPassPerMinute, "1 m"), body.account.toLowerCase(), RELAY_ERRORS.rateLimitedPass);
    const txHash = await relayWithdraw(relayerDeps(), body.token, body.account);
    return json({ txHash });
  });
}
