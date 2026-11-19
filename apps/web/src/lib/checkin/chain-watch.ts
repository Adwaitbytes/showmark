import { keccak256, stringToHex, zeroAddress, type Address, type Hex } from "viem";
import { addresses } from "@/lib/chain/addresses";
import { activeChain } from "@/lib/chain/chains";
import type { TxState } from "./api";

// Direct reads from the QIE RPC (CORS is open) for the check-in screen, so a lost or slow HTTP
// response from our own API never decides how long someone waits for their stamp.
//
// Plain JSON-RPC over fetch with hand-encoded calldata, on purpose: a viem client with the same
// three reads added 36 kB gzipped to the door route (74 kB with createPublicClient). The encoding
// is fixed-width (uint256 and address arguments, a static tuple result), so there is little to get
// wrong; chain-watch.test.ts checks it against viem's own encoder.

const PRESENCE_OF = keccak256(stringToHex("presenceOf(uint256,address)")).slice(0, 10);
const CHECKED_IN_TOPIC = keccak256(stringToHex("CheckedIn(uint256,address,uint8,address,uint64,uint32)"));

/** How far back to look for the CheckedIn log: about 30 minutes of 3.6 s blocks. */
const LOG_LOOKBACK_BLOCKS = BigInt(500);
const RPC_TIMEOUT_MS = 4_000;

const word = (value: bigint) => value.toString(16).padStart(64, "0");
const addressWord = (address: Address) => address.slice(2).toLowerCase().padStart(64, "0");

/** presenceOf(eventId, attendee) calldata. */
export function presenceCalldata(eventId: bigint, attendee: Address): Hex {
  return `${PRESENCE_OF}${word(eventId)}${addressWord(attendee)}` as Hex;
}

/** The mode in presenceOf's (uint8 mode, uint64 at) result; 0 means absent. */
export function presenceMode(result: string): number | null {
  if (!/^0x[0-9a-fA-F]{128}$/.test(result)) return null;
  return Number.parseInt(result.slice(2, 66), 16);
}

/** The eth_getLogs filter for this attendee's CheckedIn log. */
export function checkedInFilter(eventId: bigint, attendee: Address, fromBlock: bigint, toBlock: bigint) {
  return {
    address: addresses.registry,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    topics: [CHECKED_IN_TOPIC, `0x${word(eventId)}`, `0x${addressWord(attendee)}`],
  };
}

let nextId = 1;

/** One JSON-RPC call, trying each QIE endpoint in turn. Throws when none answers. */
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastError: unknown = null;
  for (const url of activeChain.rpcUrls.default.http) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
        signal: controller.signal,
        cache: "no-store",
      });
      const body = (await response.json()) as { result?: T; error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? "rpc error");
      return body.result as T;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("no rpc endpoint");
}

function registryReady(): boolean {
  return addresses.registry !== zeroAddress;
}

/** True once the registry has recorded presence for this attendee. Null when the chain cannot be read. */
export async function chainPresence(eventId: bigint, attendee: Address): Promise<boolean | null> {
  if (!registryReady()) return null;
  try {
    const result = await rpc<string>("eth_call", [{ to: addresses.registry, data: presenceCalldata(eventId, attendee) }, "latest"]);
    const mode = presenceMode(result);
    return mode === null ? null : mode > 0;
  } catch {
    return null;
  }
}

/** The receipt status read from the chain. Null when the RPC cannot answer, so the caller asks our API. */
export async function chainReceipt(hash: Hex): Promise<TxState | null> {
  try {
    const receipt = await rpc<{ status?: string; blockNumber?: string } | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt) return { status: "pending" };
    const blockNumber = receipt.blockNumber ? BigInt(receipt.blockNumber).toString() : undefined;
    return { status: receipt.status === "0x1" ? "success" : "reverted", ...(blockNumber ? { blockNumber } : {}) };
  } catch {
    return null;
  }
}

/** The transaction that recorded this check-in, from its CheckedIn log. Null when not found yet. */
export async function findCheckInTx(eventId: bigint, attendee: Address): Promise<Hex | null> {
  if (!registryReady()) return null;
  try {
    const latest = BigInt(await rpc<string>("eth_blockNumber", []));
    const from = latest > LOG_LOOKBACK_BLOCKS ? latest - LOG_LOOKBACK_BLOCKS : BigInt(0);
    const logs = await rpc<{ transactionHash?: string }[]>("eth_getLogs", [checkedInFilter(eventId, attendee, from, latest)]);
    const hash = logs.at(-1)?.transactionHash;
    return hash && /^0x[0-9a-fA-F]{64}$/.test(hash) ? (hash as Hex) : null;
  } catch {
    return null;
  }
}
