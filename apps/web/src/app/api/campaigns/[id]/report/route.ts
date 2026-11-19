import type { NextRequest } from "next/server";
import { AppError, READ_ERRORS } from "@/server/errors";
import { CACHE, cacheControl, handle, json, parseWith } from "@/server/http";
import { getCampaign } from "@/server/queries";
import { campaignCsv } from "@/server/report";
import { reportQuerySchema, searchParamsObject } from "@/server/schemas";

/** Sponsor report: every settlement with its transaction. `?format=csv` downloads a spreadsheet, json is the default. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/report">): Promise<Response> {
  return handle("campaigns.report", async () => {
    const { format } = parseWith(reportQuerySchema, searchParamsObject(request.nextUrl.searchParams));
    const id = (await ctx.params).id;
    const campaign = await getCampaign(id, { settlementLimit: null });
    if (!campaign) throw new AppError(404, READ_ERRORS.notFound);
    if (format === "json") return json({ generatedAt: new Date().toISOString(), campaign }, { cache: CACHE.live });
    return new Response(campaignCsv(campaign), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="showmark-campaign-${campaign.id}.csv"`,
        "cache-control": cacheControl(CACHE.live),
      },
    });
  });
}
