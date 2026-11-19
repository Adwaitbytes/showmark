import type { NextRequest } from "next/server";
import { AppError, READ_ERRORS } from "@/server/errors";
import { CACHE, handle, json } from "@/server/http";
import { getCampaign } from "@/server/queries";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/campaigns/[id]">): Promise<Response> {
  return handle("campaigns.id", async () => {
    const campaign = await getCampaign((await ctx.params).id);
    if (!campaign) throw new AppError(404, READ_ERRORS.notFound);
    return json(campaign, { cache: CACHE.live });
  });
}
