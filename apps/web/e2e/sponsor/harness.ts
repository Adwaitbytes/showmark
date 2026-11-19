/**
 * Test harness for the sponsor console: a fake QIE Wallet (EIP-6963, rdns me.qiewallet) injected into the page, a
 * JSON-RPC mock for the QIE testnet endpoint that answers like CampaignVault, the oracle and QUSDC would, and /api
 * mocks shaped like INTERFACES section 3. Everything stays inside the browser context; nothing reaches a real chain.
 */
import type { Page, Route } from "@playwright/test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  keccak256,
  numberToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { createSiweMessage } from "viem/siwe";
import { aggregatorAbi, erc20Abi, vaultAbi } from "../../src/lib/chain/abi";
import { vaultSponsorAbi } from "../../src/lib/sponsor/abi";

/** E2E_CHAIN=1990 runs against a mainnet build (QIEDEX funding); the default is testnet. */
export const MAINNET = process.env.E2E_CHAIN === "1990";
export const CHAIN_ID = MAINNET ? 1990 : 1983;
const CHAIN_HEX = MAINNET ? "0x7c6" : "0x7bf";
export const PORT = MAINNET ? 3208 : 3207;
export const BASE_URL = `http://localhost:${PORT}`;
export const RPC_URL = MAINNET ? "https://rpc1mainnet.qie.digital" : "https://rpc1testnet.qie.digital";
const RPC_PATTERN = MAINNET ? /^https:\/\/rpc[1-5]mainnet\.qie\.digital/ : /^https:\/\/rpc1testnet\.qie\.digital/;

// Placeholder contract addresses the dev server is started with (see playwright.config.ts).
export const ADDR = {
  registry: getAddress("0x1000000000000000000000000000000000000001"),
  vault: getAddress("0x1000000000000000000000000000000000000002"),
  qusdc: getAddress("0x1000000000000000000000000000000000000003"),
  oracle: getAddress("0x1000000000000000000000000000000000000004"),
  zone: getAddress("0x1000000000000000000000000000000000000005"),
} as const;

export const SPONSOR = getAddress("0x7ae3b1c9d4f20a8e6b5c3d1f9a2e4b6c8d0f1a3b");
export const FEE_BPS = 250;
export const ORACLE_ANSWER = 15_947_567n; // $0.15947567, 8 decimals
export const NEW_CAMPAIGN_ID = 8n;

export const ENV = {
  NEXT_PUBLIC_CHAIN_ID: String(CHAIN_ID),
  NEXT_PUBLIC_REGISTRY_ADDRESS: ADDR.registry,
  NEXT_PUBLIC_STAMP_ADDRESS: getAddress("0x1000000000000000000000000000000000000006"),
  NEXT_PUBLIC_VAULT_ADDRESS: ADDR.vault,
  NEXT_PUBLIC_BOND_ADDRESS: getAddress("0x1000000000000000000000000000000000000007"),
  NEXT_PUBLIC_LENS_ADDRESS: getAddress("0x1000000000000000000000000000000000000008"),
  NEXT_PUBLIC_QUSDC_ADDRESS: ADDR.qusdc,
  NEXT_PUBLIC_ZONE_ADDRESS: ADDR.zone,
  NEXT_PUBLIC_ORACLE_ADDRESS: ADDR.oracle,
} as const;

export interface SentTx {
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  hash: Hex;
}

export interface ChainState {
  now: number;
  nativeBalance: bigint;
  qusdcBalance: bigint;
  allowance: bigint;
  oracleUpdatedAt: number;
  campaign: CampaignStruct | null;
  sent: SentTx[];
  /** Lets a test model side effects of a sent transaction, such as a swap delivering QUSDC. */
  onSend?: (tx: SentTx, state: ChainState) => void;
}

export interface CampaignStruct {
  sponsor: Address;
  pricing: number;
  attendeeShareBps: number;
  feeBps: number;
  minProofMode: number;
  requireQieId: boolean;
  openToBonded: boolean;
  token: Address;
  maxPerEvent: number;
  maxTotal: number;
  settledCount: number;
  startsAt: bigint;
  endsAt: bigint;
  amountPerPresence: bigint;
  minBond: bigint;
  balance: bigint;
}

export function chainState(overrides: Partial<ChainState> = {}): ChainState {
  const now = Math.floor(Date.now() / 1000);
  return {
    now,
    nativeBalance: 5_000n * 10n ** 18n,
    qusdcBalance: 1_000n * 10n ** 6n,
    allowance: 0n,
    oracleUpdatedAt: now - 3 * 3600,
    campaign: null,
    sent: [],
    ...overrides,
  };
}

// ------------------------------------------------------------------------------------------ fake wallet

/** Runs in the page. Announces a QIE Wallet that forwards everything to the mocked RPC endpoint. */
function walletScript({ account, rpc, chainHex }: { account: string; rpc: string; chainHex: string }) {
  let id = 0;
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  async function forward(method: string, params: unknown) {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
    });
    const body = (await response.json()) as { result?: unknown; error?: { code: number; message: string } };
    if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
    return body.result;
  }
  const provider = {
    isMetaMask: true,
    async request({ method, params }: { method: string; params?: unknown }) {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account];
        case "eth_chainId":
          return chainHex;
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        case "personal_sign":
          return `0x${"ab".repeat(64)}1b`;
        case "eth_sendTransaction":
          return forward("test_sendTransaction", params);
        default:
          return forward(method, params);
      }
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(fn);
    },
    removeListener(event: string, fn: (...args: unknown[]) => void) {
      listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
    },
  };
  const info = { uuid: "test-qie-wallet", name: "QIE Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "me.qiewallet" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

export async function installWallet(page: Page, account: Address = SPONSOR): Promise<void> {
  await page.addInitScript(walletScript, { account, rpc: RPC_URL, chainHex: CHAIN_HEX });
}

// -------------------------------------------------------------------------------------------- JSON-RPC

interface RpcRequest {
  id: number;
  method: string;
  params?: unknown[];
}

const campaignCreatedTopics = (id: bigint, sponsor: Address, token: Address) =>
  encodeEventTopics({ abi: vaultAbi, eventName: "CampaignCreated", args: { campaignId: id, sponsor, token } });

function callResult(state: ChainState, to: string, data: Hex): Hex {
  const target = getAddress(to);
  if (target === ADDR.vault) {
    const call = decodeFunctionData({ abi: [...vaultAbi, ...vaultSponsorAbi], data });
    switch (call.functionName) {
      case "feeBps":
        return encodeFunctionResult({ abi: vaultSponsorAbi, functionName: "feeBps", result: FEE_BPS });
      case "maxOracleAge":
        return encodeFunctionResult({ abi: vaultSponsorAbi, functionName: "maxOracleAge", result: 172_800n });
      case "campaign":
        if (!state.campaign) throw new Error("UnknownCampaign");
        return encodeFunctionResult({ abi: vaultSponsorAbi, functionName: "campaign", result: state.campaign });
      default:
        // Simulations of writes succeed.
        return "0x";
    }
  }
  if (target === ADDR.oracle) {
    const call = decodeFunctionData({ abi: aggregatorAbi, data });
    if (call.functionName === "decimals") return encodeFunctionResult({ abi: aggregatorAbi, functionName: "decimals", result: 8 });
    return encodeFunctionResult({
      abi: aggregatorAbi,
      functionName: "latestRoundData",
      result: [42n, ORACLE_ANSWER, BigInt(state.oracleUpdatedAt), BigInt(state.oracleUpdatedAt), 42n],
    });
  }
  if (target === ADDR.qusdc) {
    const call = decodeFunctionData({ abi: erc20Abi, data });
    if (call.functionName === "balanceOf") return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: state.qusdcBalance });
    if (call.functionName === "allowance") return encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: state.allowance });
    return encodeFunctionResult({ abi: erc20Abi, functionName: "approve", result: true });
  }
  // The QIEDEX router: a simulated swap succeeds.
  if (target === getAddress("0x08cd2e72e156D8563B4351eb4065C262A9f553Ef")) return "0x";
  throw new Error(`No mock for call to ${to}`);
}

function receiptFor(state: ChainState, hash: Hex) {
  const tx = state.sent.find((t) => t.hash === hash);
  if (!tx) return null;
  const logs: unknown[] = [];
  if (tx.to === ADDR.vault) {
    const call = decodeFunctionData({ abi: vaultAbi, data: tx.data });
    if (call.functionName === "createCampaign") {
      const [p] = call.args;
      logs.push({
        address: ADDR.vault,
        topics: campaignCreatedTopics(NEW_CAMPAIGN_ID, tx.from, p.token),
        data: encodeAbiParameters(
          [
            { type: "uint8" },
            { type: "uint128" },
            { type: "uint16" },
            { type: "uint8" },
            { type: "bool" },
            { type: "uint64" },
            { type: "uint64" },
            { type: "uint16" },
            { type: "string" },
          ],
          [p.pricing, p.amountPerPresence, p.attendeeShareBps, p.minProofMode, p.requireQieId, p.startsAt, p.endsAt, FEE_BPS, p.metadata],
        ),
        blockNumber: "0x10",
        transactionHash: hash,
        transactionIndex: "0x0",
        blockHash: `0x${"11".repeat(32)}`,
        logIndex: "0x0",
        removed: false,
      });
    }
  }
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash: `0x${"11".repeat(32)}`,
    blockNumber: "0x10",
    from: tx.from,
    to: tx.to,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x3b9aca00",
    contractAddress: null,
    logs,
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    type: "0x0",
  };
}

function handleRpc(state: ChainState, req: RpcRequest): unknown {
  const params = req.params ?? [];
  switch (req.method) {
    case "eth_chainId":
      return CHAIN_HEX;
    case "eth_blockNumber":
      return "0x10";
    case "eth_getBalance":
      return numberToHex(state.nativeBalance);
    case "eth_gasPrice":
      return "0x3b9aca00";
    case "eth_maxPriorityFeePerGas":
      return "0x0";
    case "eth_estimateGas":
      return "0x30000";
    case "eth_getTransactionCount":
      return "0x1";
    case "eth_getBlockByNumber":
      return { number: "0x10", hash: `0x${"11".repeat(32)}`, timestamp: numberToHex(state.now), baseFeePerGas: "0x0", transactions: [] };
    case "eth_call": {
      const [call] = params as [{ to: string; data: Hex }];
      return callResult(state, call.to, call.data);
    }
    case "test_sendTransaction": {
      const [tx] = params as [{ from: string; to: string; data?: Hex; value?: Hex }];
      const sent: SentTx = {
        from: getAddress(tx.from),
        to: getAddress(tx.to),
        data: tx.data ?? "0x",
        value: tx.value ? BigInt(tx.value) : 0n,
        hash: keccak256(toHex(`tx-${state.sent.length}-${tx.data ?? ""}`)),
      };
      state.sent.push(sent);
      if (sent.to === ADDR.qusdc) {
        const call = decodeFunctionData({ abi: erc20Abi, data: sent.data });
        if (call.functionName === "approve") state.allowance = call.args[1];
      }
      state.onSend?.(sent, state);
      return sent.hash;
    }
    case "eth_getTransactionReceipt":
      return receiptFor(state, (params as [Hex])[0]);
    case "eth_getTransactionByHash":
      return null;
    default:
      throw new Error(`Unmocked RPC ${req.method}`);
  }
}

export async function mockChain(page: Page, state: ChainState): Promise<void> {
  await page.route(RPC_PATTERN, (route) => answerRpc(route, state));
}

async function answerRpc(route: Route, state: ChainState): Promise<void> {
  const body = route.request().postDataJSON() as RpcRequest | RpcRequest[];
  const one = (req: RpcRequest) => {
    try {
      return { jsonrpc: "2.0", id: req.id, result: handleRpc(state, req) };
    } catch (error) {
      return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: error instanceof Error ? error.message : "mock error" } };
    }
  };
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
}

// --------------------------------------------------------------------------------------------- /api

export interface ApiMocks {
  campaigns?: unknown[];
  campaign?: unknown;
  events?: unknown[];
  /** Status for every /api call, to render error states. */
  failWith?: number;
  /** Start already signed in. */
  signedIn?: boolean;
  /** Body for /api/dex/quote. */
  dexQuote?: unknown;
}

export async function mockApi(page: Page, mocks: ApiMocks = {}): Promise<{ signedIn: () => boolean }> {
  let signedIn = mocks.signedIn ?? false;
  const session = () => ({ address: SPONSOR, qieName: "acme.qie", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
  const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const error = (route: Route, status: number) =>
    json(route, status, { error: { code: "test", message: "Showmark could not read this just now.", action: "Try again in a moment." } });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/auth/session" && route.request().method() === "DELETE") {
      signedIn = false;
      return json(route, 200, { signedOut: true });
    }
    if (path === "/api/auth/session") return signedIn ? json(route, 200, session()) : json(route, 401, { error: { code: "unauthorized", message: "Not signed in.", action: "Sign in." } });
    if (path === "/api/auth/nonce") {
      const nonce = "testnonce12345";
      const message = createSiweMessage({
        address: getAddress(url.searchParams.get("address") ?? SPONSOR),
        chainId: CHAIN_ID,
        domain: url.host,
        uri: url.origin,
        nonce,
        version: "1",
        statement: "Sign in to Showmark. This request does not send a transaction or cost gas.",
      });
      return json(route, 200, { nonce, message, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString() });
    }
    if (path === "/api/auth/verify") {
      signedIn = true;
      return json(route, 200, session());
    }
    if (mocks.failWith) return error(route, mocks.failWith);
    if (path === "/api/campaigns") return json(route, 200, mocks.campaigns ?? []);
    const report = path.match(/^\/api\/campaigns\/(\d+)\/report$/);
    if (report) {
      if (!mocks.campaign) return error(route, 404);
      if (url.searchParams.get("format") === "csv") return route.fulfill({ status: 200, contentType: "text/csv", body: "campaign_id\n" });
      return json(route, 200, { generatedAt: new Date().toISOString(), campaign: mocks.campaign });
    }
    if (/^\/api\/campaigns\/\d+$/.test(path)) return mocks.campaign ? json(route, 200, mocks.campaign) : error(route, 404);
    if (path === "/api/events") return json(route, 200, mocks.events ?? []);
    if (path === "/api/dex/quote") return mocks.dexQuote ? json(route, 200, mocks.dexQuote) : error(route, 503);
    return error(route, 404);
  });
  return { signedIn: () => signedIn };
}
