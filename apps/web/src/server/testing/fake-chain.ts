import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { qieTestnet } from "@/lib/chain/chains";

export type ContractHandler = (functionName: string, args: readonly unknown[]) => unknown;

interface Registered {
  abi: Abi;
  handler: ContractHandler;
}

/**
 * A PublicClient whose eth_call is answered by plain functions per contract address. Calls are decoded and results
 * encoded with the real ABIs, so code under test goes through viem's full encode and decode path.
 */
export function fakeChainClient(contracts: Record<Address, Registered>, extra: Record<string, (params: unknown) => unknown> = {}): PublicClient {
  const byAddress = new Map(Object.entries(contracts).map(([address, c]) => [address.toLowerCase(), c] as const));
  return createPublicClient({
    chain: qieTestnet,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        if (method === "eth_chainId") return `0x${qieTestnet.id.toString(16)}`;
        if (method === "eth_call") {
          const [call] = params as [{ to: Address; data: Hex }];
          const target = byAddress.get(call.to.toLowerCase());
          if (!target) throw new Error(`fake chain: no contract at ${call.to}`);
          const { functionName, args } = decodeFunctionData({ abi: target.abi, data: call.data });
          const result = target.handler(functionName, args ?? []);
          return encodeFunctionResult({ abi: target.abi, functionName, result } as Parameters<typeof encodeFunctionResult>[0]);
        }
        const handler = extra[method];
        if (handler) return handler(params);
        throw new Error(`fake chain: ${method} is not implemented`);
      },
    }),
  });
}
