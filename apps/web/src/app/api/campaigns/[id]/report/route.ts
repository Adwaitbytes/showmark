import type { NextRequest } from "next/server";
import type { CampaignDetail } from "@/lib/api/types";
import { explorerTx } from "@/lib/chain/chains";
import { AppError, READ_ERRORS } from "@/server/errors";
import { CACHE, cacheControl, handle, json, parseWith } from "@/server/http";
import { getCampaign } from "@/server/queries";
import { reportQuerySchema, searchParamsObject } from "@/server/schemas";

const COLUMNS = ["campaign_id", "event_id", "event_name", "attendee", "organizer", "token", "gross", "to_attendee", "to_organizer", "fee", "settled_at", "tx", "explorer_url"] as const;

/** Quotes a CSV field and defuses spreadsheet formulas (a leading = + - @ tab or return), since event names are user input. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function campaignCsv(campaign: CampaignDetail): string {
  const rows = campaign.settlements.map((s) =>
    [s.campaignId, s.eventId, s.eventName, s.attendee, s.organizer, campaign.tokenSymbol, s.gross, s.toAttendee, s.toOrganizer, s.fee, s.at, s.tx, explorerTx(s.tx)].map(csvField).join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

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
