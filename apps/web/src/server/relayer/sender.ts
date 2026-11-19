import { BaseError, NonceTooLowError, isAddressEqual, keccak256, toFunctionSelector, zeroAddress, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import type { KeyValueStore } from "../kv";
import type { Lock } from "../lock";
import { log } from "../log";

// Sends relayer transactions with explicit, serialized nonces. Callers hold the relayer lock (SET NX PX) for the
// whole sequence, so two serverless instances never pick the same nonce. The next nonce is also kept in Redis,
// because a public RPC behind a load balancer can answer `pending` from a node that has not seen our last send.

export interface RelayerChain {
  chainId: number;
  client: PublicClient;
  account: LocalAccount;
  registry: Address;
  vault: Address;
  /** OrganizerBond; the relayer may call only `refreshClaim` on it. Zero when not configured. */
  bond: Address;
}

export interface TxRequest {
  to: Address;
  data: Hex;
  gas: bigint;
  /** For logs only, for example "checkInBatch". */
  label: string;
}

export interface SentTx {
  hash: Hex;
  nonce: number;
  label: string;
}

/** A Redis nonce older than this is ignored in favour of the chain, so a dropped transaction cannot leave a gap. */
const NONCE_TRUST_MS = 60_000;
const LOCK_TTL_MS = 5_000;
const LOCK_FRESH_MS = 2_000;

interface StoredNonce {
  nonce: number;
  at: number;
}

export class RelayTargetError extends Error {
  constructor(to: Address) {
    super(`Refusing to relay to ${to}: only the registry, the vault and the bond's refreshClaim are allowed`);
    this.name = "RelayTargetError";
  }
}

export class LockLostError extends Error {
  constructor() {
    super("The relayer lock expired before the transaction was sent");
    this.name = "LockLostError";
  }
}

function nonceKey(chain: RelayerChain): string {
  return `relay:nonce:${chain.chainId}:${chain.account.address.toLowerCase()}`;
}

const REFRESH_CLAIM = toFunctionSelector("function refreshClaim(uint256 challengeId)");

export function assertRelayTarget(chain: RelayerChain, to: Address, data: Hex): void {
  if (isAddressEqual(to, chain.registry) || isAddressEqual(to, chain.vault)) return;
  // Audit I4-01: the relayer keeps challenge claims current after bonded payouts, and may do nothing else there.
  if (chain.bond !== zeroAddress && isAddressEqual(to, chain.bond) && data.slice(0, 10).toLowerCase() === REFRESH_CLAIM) return;
  throw new RelayTargetError(to);
}

async function chainNonce(chain: RelayerChain): Promise<number> {
  return chain.client.getTransactionCount({ address: chain.account.address, blockTag: "pending" });
}

async function startingNonce(chain: RelayerChain, kv: KeyValueStore, now: number): Promise<number> {
  const [fromChain, raw] = await Promise.all([chainNonce(chain), kv.get(nonceKey(chain))]);
  if (!raw) return fromChain;
  const stored = JSON.parse(raw) as StoredNonce;
  if (now - stored.at > NONCE_TRUST_MS) return fromChain;
  return Math.max(fromChain, stored.nonce);
}

const GAS_PRICE_CACHE_MS = 30_000;
const gasPriceCache = new Map<number, { at: number; price: bigint }>();

/**
 * Gas price as the chain reports it, plus 10 percent so a small base fee move does not strand the batch. Cached
 * per instance for 30 s: QIE's base fee is flat, and the read is one RPC round trip off every check-in.
 */
export async function relayGasPrice(chain: RelayerChain, now: number = Date.now()): Promise<bigint> {
  const cached = gasPriceCache.get(chain.chainId);
  if (cached && now - cached.at < GAS_PRICE_CACHE_MS) return cached.price;
  const price = ((await chain.client.getGasPrice()) * 110n + 99n) / 100n;
  gasPriceCache.set(chain.chainId, { at: now, price });
  return price;
}

export interface PreparedSend {
  nonce: number;
  gasPrice: bigint;
}

/** Nonce and gas price for the next send, read together so they cost one round trip of latency. */
export async function prepareSend(chain: RelayerChain, kv: KeyValueStore, now: number = Date.now()): Promise<PreparedSend> {
  const [nonce, gasPrice] = await Promise.all([startingNonce(chain, kv, now), relayGasPrice(chain, now)]);
  return { nonce, gasPrice };
}

// eth_sendRawTransaction errors are not mapped to typed viem errors, so the node's message is matched too.
// Cosmos EVM nodes say "invalid nonce; got N, expected M: invalid sequence".
const NONCE_TOO_LOW = /nonce too low|invalid nonce|invalid sequence/i;

const ALREADY_KNOWN = /already known|already imported|tx already in mempool/i;

function matches(error: unknown, pattern: RegExp): boolean {
  return error instanceof BaseError && error.walk((e) => e instanceof Error && pattern.test(e.message)) !== null;
}

export function isNonceTooLow(error: unknown): boolean {
  if (matches(error, ALREADY_KNOWN)) return false;
  return (error instanceof BaseError && error.walk((e) => e instanceof NonceTooLowError) !== null) || matches(error, NONCE_TOO_LOW);
}

/** The node already has this exact signed transaction, for example because a fallback endpoint forwarded it. */
export function isAlreadyKnown(error: unknown): boolean {
  return matches(error, ALREADY_KNOWN);
}

/**
 * Sends `requests` in order with consecutive nonces while `lock` is held. Stops at the first failure and returns
 * what was sent, plus the error, so a check-in that went out is never reported as failed because the settlement
 * behind it did not.
 */
export async function sendSequential(
  chain: RelayerChain,
  kv: KeyValueStore,
  lock: Lock,
  requests: TxRequest[],
  now: () => number = Date.now,
  prepared?: PreparedSend,
  /** Runs right after each broadcast, concurrently with the rest (for example writing the check-in result). */
  onBroadcast?: (tx: SentTx) => Promise<void>,
): Promise<{ sent: SentTx[]; error: unknown }> {
  for (const r of requests) {
    assertRelayTarget(chain, r.to, r.data);
    // Never let a node fill in gas: QIE testnet answers eth_fillTransaction with intrinsic gas only.
    if (r.gas <= 21_000n) throw new Error(`Refusing to send ${r.label} without an explicit gas limit`);
  }
  const sent: SentTx[] = [];
  if (requests.length === 0) return { sent, error: null };

  const ready = prepared ?? (await prepareSend(chain, kv, now()));
  let nonce = ready.nonce;
  const gasPrice = ready.gasPrice;

  // Bookkeeping writes (stored nonce, results) overlap with the next signature; all of them finish before return.
  const pending: Promise<void>[] = [];
  const settle = async <T>(value: T): Promise<T> => {
    const outcomes = await Promise.allSettled(pending);
    for (const o of outcomes) if (o.status === "rejected") log.error("relayer.bookkeeping_failed", { error: o.reason });
    return value;
  };

  for (const request of requests) {
    // A lock taken or extended in the last 2 s has at least 3 s left; skip the Redis round trip.
    if (now() - lock.refreshedAt > LOCK_FRESH_MS && !(await lock.extend(LOCK_TTL_MS))) return settle({ sent, error: new LockLostError() });
    let attempt = 0;
    for (;;) {
      try {
        const serializedTransaction = await chain.account.signTransaction({
          chainId: chain.chainId,
          type: "legacy",
          to: request.to,
          data: request.data,
          gas: request.gas,
          gasPrice,
          nonce,
          value: 0n,
        });
        const hash = keccak256(serializedTransaction);
        try {
          await chain.client.sendRawTransaction({ serializedTransaction });
        } catch (error) {
          if (!isAlreadyKnown(error)) throw error;
        }
        const tx: SentTx = { hash, nonce, label: request.label };
        sent.push(tx);
        nonce += 1;
        pending.push(kv.set(nonceKey(chain), JSON.stringify({ nonce, at: now() } satisfies StoredNonce), { px: 10 * 60_000 }).then(() => undefined));
        if (onBroadcast) pending.push(onBroadcast(tx));
        log.info("relayer.tx_sent", { label: request.label, hash, nonce: nonce - 1, gas: request.gas, gasPrice });
        break;
      } catch (error) {
        if (attempt === 0 && isNonceTooLow(error)) {
          attempt += 1;
          const fresh = await chainNonce(chain);
          log.warn("relayer.nonce_resync", { label: request.label, tried: nonce, chain: fresh });
          nonce = Math.max(fresh, nonce + 1);
          continue;
        }
        log.error("relayer.send_failed", { label: request.label, nonce, error });
        return settle({ sent, error });
      }
    }
  }
  return settle({ sent, error: null });
}
