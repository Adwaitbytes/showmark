import type { NextRequest } from "next/server";
import { CACHE, handle, json, parseWith } from "@/server/http";
import { listEvents } from "@/server/queries";
import { eventsQuerySchema, searchParamsObject } from "@/server/schemas";

/** Indexed events. `?organizer=0x..` filters by organizer, `?upcoming=1` keeps events that have not ended. */
export async function GET(request: NextRequest): Promise<Response> {
  return handle("events", async () => {
    const query = parseWith(eventsQuerySchema, searchParamsObject(request.nextUrl.searchParams));
    return json(await listEvents(query), { cache: CACHE.live });
  });
}
