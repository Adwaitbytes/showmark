import type { NextRequest } from "next/server";
import { AppError, READ_ERRORS } from "@/server/errors";
import { CACHE, handle, json } from "@/server/http";
import { getPassport } from "@/server/queries";

/** A passport by address or QIE ID name (`alice.qie`). Unknown names are 404; unknown addresses are an empty passport. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/passport/[addressOrName]">): Promise<Response> {
  return handle("passport", async () => {
    const key = decodeURIComponent((await ctx.params).addressOrName);
    if (key.length > 100) throw new AppError(400, READ_ERRORS.invalidAddress);
    const passport = await getPassport(key);
    if (!passport) throw new AppError(404, READ_ERRORS.nameNotFound);
    return json(passport, { cache: CACHE.live });
  });
}
