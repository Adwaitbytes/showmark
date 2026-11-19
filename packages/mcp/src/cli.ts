import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AddressInfo } from "node:net";
import { parseArgs } from "node:util";
import { ShowmarkConfigProblem, optionsFromEnv } from "./config";
import { startHttpServer } from "./node-http";
import { SERVER_VERSION, createShowmarkMcpServer } from "./server";

const HELP = `showmark-mcp ${SERVER_VERSION}: read-only MCP server for Showmark on QIE

Usage:
  showmark-mcp                      serve over stdio (for Claude Code, Claude Desktop, Cursor)
  showmark-mcp --http [--port 3333] [--host 127.0.0.1]
                                    serve stateless Streamable HTTP at http://host:port/mcp

Environment:
  SHOWMARK_API_URL            Showmark site for indexed data, for example https://showmark.app
  SHOWMARK_CHAIN_ID           1990 mainnet (default) or 1983 testnet
  SHOWMARK_REGISTRY_ADDRESS   ShowmarkRegistry, for on-chain presence reads
  SHOWMARK_VAULT_ADDRESS      CampaignVault, for live quotes
  SHOWMARK_LENS_ADDRESS       PresenceLens, optional
  SHOWMARK_RPC_URL            comma-separated RPC endpoints, optional
`;

// stdout belongs to the MCP protocol in stdio mode, so everything human goes to stderr.
function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      http: { type: "boolean", default: false },
      port: { type: "string", default: "3333" },
      host: { type: "string", default: "127.0.0.1" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    log(HELP);
    return;
  }
  const options = optionsFromEnv(process.env);
  if (!options.data) log("showmark-mcp: SHOWMARK_API_URL is not set; only showmark_has_attended will work.");
  if (!options.client?.addresses.registry) log("showmark-mcp: SHOWMARK_REGISTRY_ADDRESS is not set; on-chain checks are off.");

  if (!values.http) {
    await createShowmarkMcpServer(options).connect(new StdioServerTransport());
    log("showmark-mcp: serving on stdio");
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new ShowmarkConfigProblem(`--port must be 0 to 65535, got ${values.port}`);
  const server = await startHttpServer({ options, port, host: values.host });
  const bound = server.address() as AddressInfo;
  log(`showmark-mcp: serving Streamable HTTP at http://${values.host}:${bound.port}/mcp`);
}

main().catch((error: unknown) => {
  log(`showmark-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
