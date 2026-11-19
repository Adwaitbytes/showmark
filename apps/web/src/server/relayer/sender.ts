import { BaseError, NonceTooLowError, isAddressEqual, keccak256, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
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

interface StoredNonce {
  nonce: number;
  at: number;
}

export class RelayTargetError extends Error {
  constructor(to: Address) {
    super(`Refusing to relay to ${to}: only the registry and the vault are allowed`);
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

export function assertRelayTarget(chain: RelayerChain, to: Address): void {
  if (!isAddressEqual(to, chain.registry) && !isAddressEqual(to, chain.vault)) throw new RelayTargetError(to);
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

/** Gas price as the chain reports it, plus 10 percent so a small base fee move does not strand the batch. */
export async function relayGasPrice(chain: RelayerChain): Promise<bigint> {
  const price = await chain.client.getGasPrice();
  return (price * 110n + 99n) / 100n;
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
): Promise<{ sent: SentTx[]; error: unknown }> {
  for (const r of requests) assertRelayTarget(chain, r.to);
  const sent: SentTx[] = [];
  if (requests.length === 0) return { sent, error: null };

  let nonce = await startingNonce(chain, kv, now());
  const gasPrice = await relayGasPrice(chain);

  for (const request of requests) {
    if (!(await lock.extend(LOCK_TTL_MS))) return { sent, error: new LockLostError() };
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
        sent.push({ hash, nonce, label: request.label });
        nonce += 1;
        await kv.set(nonceKey(chain), JSON.stringify({ nonce, at: now() } satisfies StoredNonce), { px: 10 * 60_000 });
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
        return { sent, error };
      }
    }
  }
  return { sent, error: null };
}
