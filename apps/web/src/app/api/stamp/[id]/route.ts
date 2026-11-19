import type { NextRequest } from "next/server";
import { AppError, READ_ERRORS } from "@/server/errors";
import { handle, json, type CachePolicy } from "@/server/http";
import { getEvent } from "@/server/queries";
import { parseTokenId, stampMetadata } from "./metadata";

// Stamp artwork changes only if an organizer edits the event's name or city, so wallets and explorers can cache it.
const STAMP_CACHE: CachePolicy = { kind: "public", sMaxAge: 300, staleWhileRevalidate: 3600 };

/** ERC-1155 metadata for PresenceStamp token {id}: name, description, the stamp as an SVG data URI, attributes. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/stamp/[id]">): Promise<Response> {
  return handle("stamp.id", async () => {
    const id = parseTokenId((await ctx.params).id);
    if (!id) throw new AppError(400, READ_ERRORS.invalidId);
    const event = await getEvent(id);
    if (!event) throw new AppError(404, READ_ERRORS.notFound);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
    return json(stampMetadata(event, siteUrl), { cache: STAMP_CACHE, headers: { "access-control-allow-origin": "*" } });
  });
}
