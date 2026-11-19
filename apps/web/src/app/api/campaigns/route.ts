import type { NextRequest } from "next/server";
import { CACHE, handle, json, parseWith } from "@/server/http";
import { listCampaigns } from "@/server/queries";
import { campaignsQuerySchema, searchParamsObject } from "@/server/schemas";

/** Campaigns with balances and settled counts. `?sponsor=0x..` filters by sponsor. */
export async function GET(request: NextRequest): Promise<Response> {
  return handle("campaigns", async () => {
    const query = parseWith(campaignsQuerySchema, searchParamsObject(request.nextUrl.searchParams));
    return json(await listCampaigns(query), { cache: CACHE.live });
  });
}
