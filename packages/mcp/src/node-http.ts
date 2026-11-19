import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handleMcpRequest } from "./http";
import type { ShowmarkMcpOptions } from "./server";

const MAX_BODY_BYTES = 1_048_576;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function hostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, options: ShowmarkMcpOptions, host: string, path: string): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== path) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: `Not found. The MCP endpoint is ${path}.` }));
    return;
  }
  // When bound to loopback, refuse other Host headers so a web page cannot reach this server by DNS rebinding.
  if (LOOPBACK.has(host) && !LOOPBACK.has(hostname(req.headers.host) ?? "")) {
    res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "Host not allowed." }));
    return;
  }
  let body: Buffer | undefined;
  if (req.method === "POST") {
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({ error: "Request body over 1 MB." }));
      return;
    }
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const request = new Request(url, { method: req.method ?? "GET", headers, ...(body ? { body: new Uint8Array(body) } : {}) });
  const response = await handleMcpRequest(request, options);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Serves the Showmark MCP server over stateless Streamable HTTP at http://{host}:{port}{path}. */
export function startHttpServer(params: { options: ShowmarkMcpOptions; port: number; host: string; path?: string }): Promise<Server> {
  const path = params.path ?? "/mcp";
  const server = createServer((req, res) => {
    handle(req, res, params.options, params.host, path).catch((error: unknown) => {
      process.stderr.write(`showmark-mcp: request failed: ${error instanceof Error ? error.message : String(error)}\n`);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error." }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.port, params.host, () => resolve(server));
  });
}
