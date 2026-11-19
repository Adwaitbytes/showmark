import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createShowmarkMcpServer, type ShowmarkMcpOptions } from "./server";

/**
 * Answers one Streamable HTTP request with a fresh, stateless server. Works anywhere Request and Response exist:
 * a Next.js route handler, Node, Bun, Deno or a worker. Responses are plain JSON, so nothing has to stay open.
 */
export async function handleMcpRequest(request: Request, options: ShowmarkMcpOptions): Promise<Response> {
  if (request.method !== "POST") {
    // Stateless servers offer no standalone SSE stream and no sessions to delete (MCP spec, Streamable HTTP).
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Send MCP JSON-RPC messages with POST." }, id: null },
      { status: 405, headers: { allow: "POST" } },
    );
  }
  const server = createShowmarkMcpServer(options);
  // No sessionIdGenerator: the transport runs stateless and must not be reused for another request.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
