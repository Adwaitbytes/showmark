import { connection } from "next/server";
import { CACHE, handle, json } from "@/server/http";
import { getTraction } from "@/server/queries";

/** INTERFACES section 6. Cached 30 seconds at the edge; every number comes from indexed chain logs. */
export async function GET(): Promise<Response> {
  // Always computed per request; the CDN cache header does the caching, never a build-time prerender.
  await connection();
  return handle("traction", async () => json(await getTraction(), { cache: CACHE.traction }));
}
