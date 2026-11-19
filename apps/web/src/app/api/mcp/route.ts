import { ShowmarkDataError, handleMcpRequest, type ShowmarkDataSource, type ShowmarkMcpOptions } from "@showmark/mcp";
import { ShowmarkClient, type ShowmarkAddresses } from "@showmark/sdk";
import { zeroAddress } from "viem";
import { addresses } from "@/lib/chain/addresses";
import { activeChain } from "@/lib/chain/chains";
import { publicClient } from "@/lib/chain/clients";
import { isAppError } from "@/server/errors";
import { getCampaign, getEvent, getPassport, getTraction, listEvents } from "@/server/queries";

// Public, read-only MCP endpoint: `claude mcp add --transport http showmark https://<site>/api/mcp`.
// Stateless Streamable HTTP with JSON responses, so every request builds a fresh server and nothing stays open.
// Indexed data comes from the same server queries the pages use, and presence is read from the registry.

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // AppError copy is written for people; pass it through instead of a generic failure.
    if (isAppError(error)) throw new ShowmarkDataError(error.copy, { cause: error });
    throw error;
  }
}

const data: ShowmarkDataSource = {
  getTraction: () => guarded(() => getTraction()),
  listEvents: (filter) => guarded(() => listEvents(filter)),
  getEvent: (id) => guarded(() => getEvent(id)),
  getCampaign: (id) => guarded(() => getCampaign(id)),
  getPassport: (addressOrName) => guarded(() => getPassport(addressOrName)),
};

function deployedAddresses(): Partial<ShowmarkAddresses> {
  const out: Partial<ShowmarkAddresses> = {};
  if (addresses.registry !== zeroAddress) out.registry = addresses.registry;
  if (addresses.vault !== zeroAddress) out.vault = addresses.vault;
  if (addresses.lens !== zeroAddress) out.lens = addresses.lens;
  return out;
}

const options: ShowmarkMcpOptions = {
  data,
  chain: activeChain,
  client: new ShowmarkClient({ chain: activeChain, publicClient, addresses: deployedAddresses() }),
};

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request, options);
}

// GET and DELETE answer 405: a stateless server has no SSE stream to open and no session to end.
export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request, options);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request, options);
}
