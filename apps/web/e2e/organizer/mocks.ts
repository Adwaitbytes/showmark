import type { Page, Route } from "@playwright/test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  numberToHex,
  type Address,
  type Hex,
} from "viem";
import { registryAbi, vaultAbi } from "../../src/lib/chain/abi";

// Test doubles for everything outside the browser: the QIE RPC, the Showmark API and QIE Wallet. The app under test
// is real; only its network and wallet are fake, so these tests exercise the same code organizers run.

export const REGISTRY: Address = getAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3");
export const VAULT: Address = getAddress("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
export const ORGANIZER: Address = getAddress("0x91c4e2b7a3d5f8e1c6a9b0d4e7f2a5c8b1d3e6f9");
export const CREATED_TX: Hex = `0x${"c1".repeat(32)}`;
export const SENT_TX: Hex = `0x${"5e".repeat(32)}`;
const CHAIN_ID_HEX = "0x7bf";

export interface MockEvent {
  id: bigint;
  name: string;
  venue: string;
  city: string;
  startsAt: number; // unix seconds
  endsAt: number;
  capacity: number;
  checkedIn: number;
  maxPassAge: number;
}

export interface MockState {
  events: Map<bigint, MockEvent>;
  /** Door keys the registry has authorized (lowercase address -> validUntil). */
  doorKeys: Map<string, bigint>;
  /** Authorize every key automatically, for tests that start on a running door. */
  authorizeAll: boolean;
  balanceWei: bigint;
  signedIn: boolean;
  /** Transactions the fake wallet was asked to send. */
  sent: { to: string; data: Hex }[];
  checkInsPosted: unknown[];
  /** Answer for /api/relay/check-in: "ok", "already" or "offline". */
  relayMode: "ok" | "already" | "offline";
  apiDown: boolean;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function sampleEvent(patch: Partial<MockEvent> = {}): MockEvent {
  const now = nowSeconds();
  return {
    id: 1n,
    name: "Builders night at Hall B",
    venue: "Hall B, second floor",
    city: "Bengaluru",
    startsAt: now - 1800,
    endsAt: now + 7200,
    capacity: 180,
    checkedIn: 41,
    maxPassAge: 120,
    ...patch,
  };
}

export function createState(patch: Partial<MockState> = {}): MockState {
  return {
    events: new Map([[1n, sampleEvent()]]),
    doorKeys: new Map(),
    authorizeAll: false,
    balanceWei: 2n * 10n ** 18n,
    signedIn: true,
    sent: [],
    checkInsPosted: [],
    relayMode: "ok",
    apiDown: false,
    ...patch,
  };
}

interface RpcRequest {
  id: number | string;
  method: string;
  params?: unknown[];
}

function block(timestamp: number) {
  const hash = `0x${"b1".repeat(32)}`;
  return {
    number: numberToHex(9_000_000),
    hash,
    parentHash: `0x${"b0".repeat(32)}`,
    timestamp: numberToHex(timestamp),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    gasLimit: "0xffffffff",
    gasUsed: "0x0",
    baseFeePerGas: "0x7",
    miner: "0x0000000000000000000000000000000000000000",
    extraData: "0x",
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: hash,
    stateRoot: hash,
    receiptsRoot: hash,
    sha3Uncles: hash,
    mixHash: hash,
    size: "0x100",
    transactions: [],
    uncles: [],
  };
}

function receipt(hash: Hex, logs: unknown[] = []) {
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: `0x${"b1".repeat(32)}`,
    blockNumber: numberToHex(8_999_000),
    from: ORGANIZER,
    to: REGISTRY,
    cumulativeGasUsed: "0x30d40",
    gasUsed: "0x30d40",
    effectiveGasPrice: "0x430e2340",
    contractAddress: null,
    logs,
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    type: "0x2",
  };
}

function eventCreatedLog(e: MockEvent, hash: Hex) {
  const topics = encodeEventTopics({ abi: registryAbi, eventName: "EventCreated", args: { eventId: e.id, organizer: ORGANIZER, seriesId: 0n } });
  const metadata = JSON.stringify({ v: 1, name: e.name, venue: e.venue, city: e.city, description: "" });
  const data = encodeAbiParameters(
    [{ type: "uint64" }, { type: "uint64" }, { type: "uint32" }, { type: "uint32" }, { type: "uint32" }, { type: "string" }],
    [BigInt(e.startsAt), BigInt(e.endsAt), e.capacity, e.maxPassAge, 0, metadata],
  );
  return {
    address: REGISTRY,
    topics,
    data,
    blockNumber: numberToHex(8_999_000),
    blockHash: `0x${"b1".repeat(32)}`,
    transactionHash: hash,
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
  };
}

function answerCall(state: MockState, to: string, data: Hex): Hex {
  if (to.toLowerCase() === REGISTRY.toLowerCase()) {
    const call = decodeFunctionData({ abi: registryAbi, data });
    if (call.functionName === "eventInfo") {
      const e = state.events.get(call.args[0]);
      return encodeFunctionResult({
        abi: registryAbi,
        functionName: "eventInfo",
        result: {
          organizer: e ? ORGANIZER : "0x0000000000000000000000000000000000000000",
          startsAt: BigInt(e?.startsAt ?? 0),
          endsAt: BigInt(e?.endsAt ?? 0),
          capacity: e?.capacity ?? 0,
          checkedIn: e?.checkedIn ?? 0,
          maxPassAge: e?.maxPassAge ?? 0,
          seriesId: 0n,
          seriesIndex: 0,
        },
      });
    }
    if (call.functionName === "doorKeyValidUntil") {
      const [eventId, key] = call.args;
      const e = state.events.get(eventId);
      const value = state.authorizeAll && e ? BigInt(e.endsAt + 3600) : (state.doorKeys.get(key.toLowerCase()) ?? 0n);
      return encodeFunctionResult({ abi: registryAbi, functionName: "doorKeyValidUntil", result: value });
    }
  }
  if (to.toLowerCase() === VAULT.toLowerCase()) {
    const call = decodeFunctionData({ abi: vaultAbi, data });
    if (call.functionName === "claimable") return encodeFunctionResult({ abi: vaultAbi, functionName: "claimable", result: 0n });
  }
  throw new Error(`Unmocked eth_call to ${to}`);
}

function answerRpc(state: MockState, req: RpcRequest): unknown {
  const params = req.params ?? [];
  switch (req.method) {
    case "eth_chainId":
      return CHAIN_ID_HEX;
    case "eth_blockNumber":
      return numberToHex(9_000_000);
    case "eth_getBlockByNumber":
      return block(nowSeconds());
    case "eth_gasPrice":
      return numberToHex(1_125_000_000n);
    case "eth_estimateGas":
      return numberToHex(200_000);
    case "eth_getBalance":
      return numberToHex(state.balanceWei);
    case "eth_getLogs":
      return [];
    case "eth_call": {
      const tx = params[0] as { to: string; data: Hex };
      return answerCall(state, tx.to, tx.data);
    }
    case "eth_getTransactionReceipt": {
      const hash = params[0] as Hex;
      if (hash === CREATED_TX) return receipt(hash, [eventCreatedLog(state.events.get(1n) ?? sampleEvent(), hash)]);
      if (hash === SENT_TX) {
        const created = [...state.events.values()].at(-1) ?? sampleEvent();
        return receipt(hash, [eventCreatedLog(created, hash)]);
      }
      return null;
    }
    default:
      throw new Error(`Unmocked RPC method ${req.method}`);
  }
}

async function handleRpc(state: MockState, route: Route) {
  const body: RpcRequest | RpcRequest[] = route.request().postDataJSON();
  const one = (req: RpcRequest) => {
    try {
      return { jsonrpc: "2.0", id: req.id, result: answerRpc(state, req) };
    } catch (error) {
      return { jsonrpc: "2.0", id: req.id, error: { code: -32603, message: String(error) } };
    }
  };
  const response = Array.isArray(body) ? body.map(one) : one(body);
  await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(response) });
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function summary(e: MockEvent) {
  return {
    id: e.id.toString(),
    organizer: ORGANIZER,
    organizerName: "campusweb3.qie",
    startsAt: iso(e.startsAt),
    endsAt: iso(e.endsAt),
    capacity: e.capacity,
    checkedIn: e.checkedIn,
    maxPassAge: e.maxPassAge,
    seriesId: "0",
    seriesIndex: 0,
    metadata: { v: 1, name: e.name, venue: e.venue, city: e.city, description: "Lightning talks, demos and dinner." },
    createdTx: CREATED_TX,
  };
}

const ATTENDEES: Address[] = [
  "0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b",
  "0x2F9d41aE7b3C5e8D1a6F0b4C9e2D7a5B3c1E8f06",
  "0x4b0897b0513fdc7c541b6d9d7e929c4e5364d2db",
  "0x583031d1113ad414f02576bd6afabfb302140225",
].map((a) => getAddress(a));

function detail(e: MockEvent) {
  return {
    ...summary(e),
    campaigns: [],
    recentCheckIns: ATTENDEES.slice(0, Math.min(ATTENDEES.length, e.checkedIn)).map((attendee, i) => ({
      attendee,
      name: i === 0 ? "asha.qie" : null,
      at: iso(nowSeconds() - 60 * (i + 1)),
      tx: `0x${(i + 1).toString(16).padStart(2, "0").repeat(32)}`,
      mode: i % 3 === 2 ? 2 : 1,
    })),
  };
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function handleApi(state: MockState, route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  if (state.apiDown) return json(route, 503, { error: { code: "upstream_unavailable", message: "A service Showmark depends on did not answer in time.", action: "Try again in a few seconds." } });
  if (path === "/api/auth/session") {
    if (route.request().method() === "DELETE") {
      state.signedIn = false;
      return json(route, 200, {});
    }
    return state.signedIn
      ? json(route, 200, { address: ORGANIZER, qieName: "campusweb3.qie", expiresAt: iso(nowSeconds() + 900) })
      : json(route, 401, { error: { code: "unauthorized", message: "You are not signed in.", action: "Sign in with QIE Wallet." } });
  }
  if (path === "/api/auth/nonce") return json(route, 200, { nonce: "n0nce1234567" });
  if (path === "/api/auth/verify") {
    state.signedIn = true;
    return json(route, 200, { address: ORGANIZER, qieName: "campusweb3.qie", expiresAt: iso(nowSeconds() + 900) });
  }
  if (path.startsWith("/api/passport/")) return json(route, 200, { qieName: "campusweb3.qie" });
  if (path === "/api/events") return json(route, 200, [...state.events.values()].reverse().map(summary));
  const eventMatch = /^\/api\/events\/(\d+)$/.exec(path);
  if (eventMatch) {
    const e = state.events.get(BigInt(eventMatch[1]));
    return e ? json(route, 200, detail(e)) : json(route, 404, { error: { code: "not_found", message: "Showmark has no record of this.", action: "Check the link and try again." } });
  }
  if (path === "/api/relay/check-in") {
    state.checkInsPosted.push(route.request().postDataJSON());
    if (state.relayMode === "offline") return route.abort("internetdisconnected");
    if (state.relayMode === "already") {
      return json(route, 422, { error: { code: "already_present", message: "You are already checked in to this event.", action: "Open your passport to see the stamp." } });
    }
    const e = state.events.get(1n);
    if (e) e.checkedIn += 1;
    return json(route, 200, { txHash: `0x${"ab".repeat(32)}`, status: "submitted" });
  }
  if (path === "/api/relay/check-in/batch") {
    const body = route.request().postDataJSON() as { items: unknown[] };
    state.checkInsPosted.push(...body.items);
    return json(route, 200, { txHash: `0x${"cd".repeat(32)}`, accepted: body.items.length });
  }
  return json(route, 404, { error: { code: "not_found", message: "Not mocked.", action: "Add a mock." } });
}

/** A QIE Wallet stand-in announced over EIP-6963. Transactions it "sends" are applied to the mock chain. */
function walletScript(organizer: string) {
  return `
    (() => {
      const listeners = {};
      const provider = {
        async request({ method, params }) {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [${JSON.stringify(organizer)}];
          if (method === "eth_chainId") return "${CHAIN_ID_HEX}";
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
          if (method === "personal_sign") return "0x" + "11".repeat(65);
          if (method === "eth_sendTransaction") return await window.__showmarkSend(params[0]);
          throw Object.assign(new Error("Unsupported in test wallet: " + method), { code: 4200 });
        },
        on(event, fn) { (listeners[event] ??= []).push(fn); },
        removeListener(event, fn) { listeners[event] = (listeners[event] || []).filter((f) => f !== fn); },
      };
      const info = { uuid: "test-qie-wallet", name: "QIE Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "me.qiewallet" };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
      try { localStorage.setItem("showmark.wallet.last", "me.qiewallet"); } catch {}
    })();
  `;
}

export interface MockOptions {
  wallet?: boolean;
}

/** Installs every mock on a page. Returns the state so a test can change the chain while the page runs. */
export async function installMocks(page: Page, state: MockState, options: MockOptions = {}): Promise<MockState> {
  await page.route(/https:\/\/rpc\d+(testnet|mainnet)\.qie\.digital\/?.*/, (route) => handleRpc(state, route));
  await page.route("**/api/**", (route) => handleApi(state, route));
  if (options.wallet !== false) {
    await page.exposeFunction("__showmarkSend", (tx: { to: string; data: Hex }) => {
      state.sent.push({ to: tx.to, data: tx.data });
      const call = decodeFunctionData({ abi: registryAbi, data: tx.data });
      if (call.functionName === "authorizeDoorKey") state.doorKeys.set(call.args[1].toLowerCase(), call.args[2]);
      if (call.functionName === "createEvent") {
        const [startsAt, endsAt, capacity, maxPassAge, , metadata] = call.args;
        const meta = JSON.parse(metadata) as { name: string; venue: string; city: string };
        const id = BigInt(state.events.size + 1);
        state.events.set(id, { id, name: meta.name, venue: meta.venue, city: meta.city, startsAt: Number(startsAt), endsAt: Number(endsAt), capacity, checkedIn: 0, maxPassAge });
      }
      return SENT_TX;
    });
    await page.addInitScript(walletScript(ORGANIZER));
  }
  return state;
}
