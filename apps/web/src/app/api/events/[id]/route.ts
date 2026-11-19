import type { NextRequest } from "next/server";
import { AppError, READ_ERRORS } from "@/server/errors";
import { CACHE, handle, json } from "@/server/http";
import { getEvent } from "@/server/queries";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/events/[id]">): Promise<Response> {
  return handle("events.id", async () => {
    const event = await getEvent((await ctx.params).id);
    if (!event) throw new AppError(404, READ_ERRORS.notFound);
    return json(event, { cache: CACHE.live });
  });
}
