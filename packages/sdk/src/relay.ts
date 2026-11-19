import { isAddress, isHex, type Address, type Hex } from "viem";
import { ShowmarkConfigError, ShowmarkInputError, ShowmarkNetworkError, ShowmarkRelayError } from "./errors";
import type { ProofMode } from "./status";

// HTTP client for the Showmark relayer (docs/INTERFACES.md section 3). The relayer pays gas, simulates every
// call before sending it, and answers errors as { error: { code, message, action } }.

/** The slice of fetch the SDK uses. The global fetch, undici and most test doubles satisfy it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RelayOptions {
  /** Base URL of a Showmark deployment, for example https://showmark.app. Requests go to {baseUrl}/api/... */
  baseUrl: string;
  /** Defaults to the global fetch. Pass one to add auth headers, retries or a test double. */
  fetch?: FetchLike;
  /** Per-request timeout. Defaults to 20 seconds. */
  timeoutMs?: number;
}

/** One check-in as the registry receives it. `doorTime` is issuedAt for mode 1 and attestedAt for mode 2. */
export interface CheckInData {
  eventId: bigint;
  attendee: Address;
  mode: ProofMode;
  doorTime: bigint;
  attendeeSig: Hex;
  doorSig: Hex;
}

export interface LinkWalletRequest {
  pass: Address;
  wallet: Address;
  deadline: bigint;
  passSig: Hex;
  walletSig: Hex;
  /** Events whose stamps move from the pass to the wallet in the same transaction. */
  relocateEventIds: readonly bigint[];
}

export interface WithdrawRequest {
  /** Zero address for native QIE, otherwise the ERC-20 address (QUSDC). */
  token: Address;
  account: Address;
}

export interface RelaySubmitted {
  txHash: Hex;
  status: "submitted";
}

export interface RelayBatchSubmitted {
  txHash: Hex;
  accepted: number;
}

export interface RelayTx {
  txHash: Hex;
}

export type TxState = "pending" | "success" | "reverted";

export interface TxStatus {
  status: TxState;
  blockNumber: bigint | null;
}

const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_RELAY_BATCH = 50;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw new ShowmarkConfigError(`Relay base URL is not a valid URL: ${baseUrl}`, { cause });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ShowmarkConfigError(`Relay base URL must use http or https, got ${url.protocol}`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTxHash(value: unknown): value is Hex {
  return typeof value === "string" && isHex(value) && value.length === 66;
}

async function readJson(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    if (response.ok) throw new ShowmarkNetworkError(`The relayer at ${url} answered with a body that is not JSON`, { cause });
    return null;
  }
}

function relayErrorFrom(status: number, body: unknown): ShowmarkRelayError {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message, action } = body.error;
    if (typeof code === "string" && typeof message === "string" && typeof action === "string") {
      return new ShowmarkRelayError({ status, apiCode: code, message, action });
    }
  }
  return new ShowmarkRelayError({
    status,
    apiCode: `HTTP_${status}`,
    message: `The relayer answered with HTTP ${status}.`,
    action: status >= 500 ? "Try again in a few seconds." : "Check the request and try again.",
  });
}

async function request(options: RelayOptions, path: string, init: { method: "GET" | "POST"; body?: Json }): Promise<unknown> {
  const url = `${normalizeBaseUrl(options.baseUrl)}${path}`;
  const doFetch: FetchLike | undefined = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") throw new ShowmarkConfigError("No fetch implementation is available; pass one in RelayOptions.fetch");
  let response: Response;
  try {
    response = await doFetch(url, {
      method: init.method,
      headers: init.body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ShowmarkNetworkError(`Could not reach the relayer at ${url}`, { cause });
  }
  const body = await readJson(response, url);
  if (!response.ok) throw relayErrorFrom(response.status, body);
  return body;
}

function malformed(path: string): ShowmarkNetworkError {
  return new ShowmarkNetworkError(`The relayer answered ${path} with an unexpected shape`);
}

function serializeCheckIn(d: CheckInData): Json {
  if (d.mode !== 1 && d.mode !== 2) throw new ShowmarkInputError(`mode must be 1 or 2, got ${String(d.mode)}`);
  if (!isAddress(d.attendee)) throw new ShowmarkInputError(`attendee is not a valid address or its checksum is wrong: ${d.attendee}`);
  if (!isHex(d.attendeeSig) || !isHex(d.doorSig)) throw new ShowmarkInputError("attendeeSig and doorSig must be 0x-prefixed hex");
  if (d.eventId < 0n || d.doorTime < 0n) throw new ShowmarkInputError("eventId and doorTime must not be negative");
  return {
    eventId: d.eventId.toString(),
    attendee: d.attendee,
    mode: d.mode,
    doorTime: d.doorTime.toString(),
    attendeeSig: d.attendeeSig,
    doorSig: d.doorSig,
  };
}

function parseSubmitted(body: unknown, path: string): RelayTx {
  if (isRecord(body) && isTxHash(body.txHash)) return { txHash: body.txHash };
  throw malformed(path);
}

/** POST /api/relay/check-in. Resolves once the relayer has simulated and sent the transaction. */
export async function relayCheckIn(options: RelayOptions, data: CheckInData): Promise<RelaySubmitted> {
  const path = "/api/relay/check-in";
  const body = await request(options, path, { method: "POST", body: serializeCheckIn(data) });
  return { txHash: parseSubmitted(body, path).txHash, status: "submitted" };
}

/** POST /api/relay/check-in/batch, for the door-scans-you offline queue. At most 50 items per call. */
export async function relayCheckInBatch(options: RelayOptions, items: readonly CheckInData[]): Promise<RelayBatchSubmitted> {
  if (items.length === 0 || items.length > MAX_RELAY_BATCH) {
    throw new ShowmarkInputError(`A batch holds 1 to ${MAX_RELAY_BATCH} check-ins, got ${items.length}`);
  }
  const path = "/api/relay/check-in/batch";
  const body = await request(options, path, { method: "POST", body: { items: items.map(serializeCheckIn) } });
  if (isRecord(body) && isTxHash(body.txHash) && typeof body.accepted === "number") {
    return { txHash: body.txHash, accepted: body.accepted };
  }
  throw malformed(path);
}

/** POST /api/relay/link-wallet. Needs the LinkWallet signature from both the pass key and the wallet. */
export async function relayLinkWallet(options: RelayOptions, req: LinkWalletRequest): Promise<RelayTx> {
  for (const [name, value] of [["pass", req.pass], ["wallet", req.wallet]] as const) {
    if (!isAddress(value)) throw new ShowmarkInputError(`${name} is not a valid address or its checksum is wrong: ${value}`);
  }
  if (!isHex(req.passSig) || !isHex(req.walletSig)) throw new ShowmarkInputError("passSig and walletSig must be 0x-prefixed hex");
  const path = "/api/relay/link-wallet";
  const body = await request(options, path, {
    method: "POST",
    body: {
      pass: req.pass,
      wallet: req.wallet,
      deadline: req.deadline.toString(),
      passSig: req.passSig,
      walletSig: req.walletSig,
      relocateEventIds: req.relocateEventIds.map((id) => id.toString()),
    },
  });
  return parseSubmitted(body, path);
}

/** POST /api/relay/withdraw. Pays the account's claimable balance to its linked wallet, or to the account itself. */
export async function relayWithdraw(options: RelayOptions, req: WithdrawRequest): Promise<RelayTx> {
  for (const [name, value] of [["token", req.token], ["account", req.account]] as const) {
    if (!isAddress(value)) throw new ShowmarkInputError(`${name} is not a valid address or its checksum is wrong: ${value}`);
  }
  const path = "/api/relay/withdraw";
  const body = await request(options, path, { method: "POST", body: { token: req.token, account: req.account } });
  return parseSubmitted(body, path);
}

/** GET /api/tx/{hash}. */
export async function getTxStatus(options: RelayOptions, hash: Hex): Promise<TxStatus> {
  if (!isTxHash(hash)) throw new ShowmarkInputError(`Not a transaction hash: ${hash}`);
  const path = `/api/tx/${hash}`;
  const body = await request(options, path, { method: "GET" });
  if (isRecord(body) && (body.status === "pending" || body.status === "success" || body.status === "reverted")) {
    const raw = body.blockNumber;
    const blockNumber = typeof raw === "string" && /^[0-9]+$/.test(raw) ? BigInt(raw) : null;
    return { status: body.status, blockNumber };
  }
  throw malformed(path);
}

export interface WaitForTxOptions {
  /** Poll interval. Defaults to 1.5 seconds. */
  intervalMs?: number;
  /** Give up after this long. Defaults to 60 seconds. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Polls GET /api/tx/{hash} until the transaction is mined. Resolves with "success" or "reverted". */
export async function waitForTx(options: RelayOptions, hash: Hex, wait: WaitForTxOptions = {}): Promise<TxStatus> {
  const interval = wait.intervalMs ?? 1_500;
  const deadline = Date.now() + (wait.timeoutMs ?? 60_000);
  for (;;) {
    const status = await getTxStatus(options, hash);
    if (status.status !== "pending") return status;
    if (Date.now() + interval > deadline) {
      throw new ShowmarkNetworkError(`Transaction ${hash} was still pending after ${wait.timeoutMs ?? 60_000} ms`);
    }
    await delay(interval, wait.signal);
  }
}
