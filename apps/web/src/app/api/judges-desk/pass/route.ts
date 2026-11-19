import { chainContext } from "@/server/chain";
import { AppError } from "@/server/errors";
import { CACHE, clientIp, enforceLimit, handle, json } from "@/server/http";
import { rateLimiter } from "@/server/kv";
import { DESK_NOT_OPEN, issueJudgesPass, judgesDeskConfig } from "./issue";

/** A desk screen asks every 15 s; a venue with many judges behind one Wi-Fi address still fits under this. */
const PER_IP_PER_MINUTE = 60;

const RATE_LIMITED = {
  code: "rate_limited",
  message: "Too many desk codes were asked for from this network in the last minute.",
  action: "Wait a minute. The desk screen picks up again by itself.",
};

/** A fresh, signed judges' desk door pass. Never cached: every response carries its own ticket key. */
export async function GET(request: Request): Promise<Response> {
  return handle("judges-desk.pass", async () => {
    await enforceLimit(rateLimiter("judges-desk-ip", PER_IP_PER_MINUTE, "1 m"), clientIp(request), RATE_LIMITED);
    const config = judgesDeskConfig();
    if (!config) throw new AppError(503, DESK_NOT_OPEN);
    const chain = chainContext();
    const pass = await issueJudgesPass({ config, client: chain.client, registry: chain.registry, origin: new URL(request.url).origin });
    return json(pass, { cache: CACHE.noStore });
  });
}
