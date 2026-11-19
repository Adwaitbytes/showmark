import type { NextRequest } from "next/server";
import { assertCronAuthorized, runCron } from "@/server/cron";
import { handle, json } from "@/server/http";

export const maxDuration = 60;

/** Indexer catch-up and settlement retries for a scheduler. Needs `Authorization: Bearer <CRON_SECRET>`. */
export async function GET(request: NextRequest): Promise<Response> {
  return handle("cron.sync", async () => {
    assertCronAuthorized(request.headers.get("authorization"));
    const result = await runCron();
    return json(result, { status: result.ok ? 200 : 503 });
  });
}
