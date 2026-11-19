import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  fallback,
  http,
  isAddress,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { presenceAbi, registryAbi, vaultAbi } from "./abi";
import { explorerTxUrl, isSupportedChainId, showmarkChains, type SupportedChainId } from "./chains";
import { buildDoorPassCheckIn } from "./checkin";
import { showmarkDeployments, type ShowmarkAddresses } from "./deployments";
import type { ShowmarkSigner } from "./eip712";
import { ShowmarkConfigError, ShowmarkContractError, ShowmarkError, ShowmarkNetworkError } from "./errors";
import type { DoorPassPayload } from "./qr";
import {
  getTxStatus,
  relayCheckIn,
  relayCheckInBatch,
  relayLinkWallet,
  relayWithdraw,
  waitForTx,
  type CheckInData,
  type FetchLike,
  type LinkWalletRequest,
  type RelayBatchSubmitted,
  type RelayOptions,
  type RelaySubmitted,
  type RelayTx,
  type TxStatus,
  type WaitForTxOptions,
  type WithdrawRequest,
} from "./relay";
import type { ProofMode } from "./status";

export interface ShowmarkClientOptions {
  /** 1990 (mainnet), 1983 (testnet), or any viem Chain, for example a local anvil chain. */
  chain: SupportedChainId | Chain;
  /** Overrides for the official deployment addresses. Required until the deployment is listed in the SDK. */
  addresses?: Partial<ShowmarkAddresses>;
  /** Bring your own viem public client. Otherwise one is created over the chain's RPC endpoints with failover. */
  publicClient?: PublicClient;
  /** RPC endpoints to use instead of the chain defaults. Ignored when publicClient is given. */
  rpcUrls?: readonly string[];
  /** Base URL of a Showmark deployment, for relay calls. For example https://showmark.app. */
  relayUrl?: string;
  /** Fetch used for relay calls. Defaults to the global fetch. */
  fetch?: FetchLike;
}

export interface ShowmarkEvent {
  id: bigint;
  organizer: Address;
  /** Unix seconds. */
  startsAt: bigint;
  endsAt: bigint;
  /** 0 means unlimited. */
  capacity: number;
  checkedIn: number;
  /** Seconds a rotating door pass stays valid. */
  maxPassAge: number;
  /** 0n when the event is not part of a series. */
  seriesId: bigint;
  /** 1-based position inside the series, 0 without a series. */
  seriesIndex: number;
}

export interface Presence {
  present: boolean;
  /** 0 when absent, otherwise the proof mode the presence was recorded with. */
  mode: 0 | ProofMode;
  /** Block timestamp of the record in Unix seconds, 0n when absent. */
  at: bigint;
}

export interface Streak {
  current: number;
  best: number;
}

export interface Campaign {
  id: bigint;
  sponsor: Address;
  /** Zero address for native QIE. */
  token: Address;
  /** 0: amountPerPresence in token units. 1: amountPerPresence in USD (6 decimals), paid in native QIE at the oracle price. */
  pricing: 0 | 1;
  amountPerPresence: bigint;
  attendeeShareBps: number;
  feeBps: number;
  minProofMode: ProofMode;
  requireQieId: boolean;
  openToBonded: boolean;
  startsAt: bigint;
  endsAt: bigint;
  maxPerEvent: number;
  maxTotal: number;
  settledCount: number;
  minBond: bigint;
  /** Remaining escrow in token base units. */
  balance: bigint;
}

export interface Quote {
  /** What one presence pays right now, in token base units (wei for native QIE). */
  amount: bigint;
  /** False when the oracle price is stale, in which case settlement waits for a fresh price. */
  priceFresh: boolean;
}

function resolveChain(chain: SupportedChainId | Chain): Chain {
  if (typeof chain !== "number") return chain;
  if (!isSupportedChainId(chain)) throw new ShowmarkConfigError(`Unknown Showmark chain id ${String(chain)}; pass a viem Chain instead`);
  return showmarkChains[chain];
}

function toMode(value: number, functionName: string): 0 | ProofMode {
  if (value === 0 || value === 1 || value === 2) return value;
  throw new ShowmarkContractError({ functionName, revertName: null, message: `${functionName} returned an unknown proof mode ${value}` });
}

function toReadError(functionName: string, error: unknown): ShowmarkError {
  if (error instanceof ShowmarkError) return error;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const revertName = reverted.data?.errorName ?? null;
      return new ShowmarkContractError(
        { functionName, revertName, message: `${functionName} reverted${revertName ? ` with ${revertName}` : ""}` },
        { cause: error },
      );
    }
    if (error.walk((e) => e instanceof ContractFunctionZeroDataError)) {
      return new ShowmarkContractError(
        { functionName, revertName: null, message: `${functionName} returned no data; check that the contract address is right for this chain` },
        { cause: error },
      );
    }
  }
  return new ShowmarkNetworkError(`Could not read ${functionName} from the chain`, { cause: error });
}

/**
 * Reads Showmark state from QIE and talks to the Showmark relayer.
 *
 * ```ts
 * const showmark = new ShowmarkClient({ chain: 1983, addresses: { registry, vault }, relayUrl: "https://showmark.app" });
 * await showmark.hasAttended(42n, "0x...");
 * ```
 */
export class ShowmarkClient {
  readonly chain: Chain;
  readonly publicClient: PublicClient;
  readonly addresses: Partial<ShowmarkAddresses>;
  private readonly relay: RelayOptions | null;

  constructor(options: ShowmarkClientOptions) {
    this.chain = resolveChain(options.chain);
    const official = isSupportedChainId(this.chain.id) ? showmarkDeployments[this.chain.id] : undefined;
    const addresses: Partial<ShowmarkAddresses> = { ...official, ...options.addresses };
    for (const [name, value] of Object.entries(addresses)) {
      if (value !== undefined && !isAddress(value, { strict: false })) throw new ShowmarkConfigError(`addresses.${name} is not a valid address: ${value}`);
    }
    this.addresses = addresses;
    this.publicClient =
      options.publicClient ??
      createPublicClient({
        chain: this.chain,
        transport: fallback(
          (options.rpcUrls ?? this.chain.rpcUrls.default.http).map((url) => http(url, { timeout: 8_000, retryCount: 1 })),
          { rank: false, retryCount: 2 },
        ),
      });
    this.relay = options.relayUrl
      ? { baseUrl: options.relayUrl, ...(options.fetch ? { fetch: options.fetch } : {}) }
      : null;
  }

  get chainId(): number {
    return this.chain.id;
  }

  private address(name: keyof ShowmarkAddresses): Address {
    const value = this.addresses[name];
    if (!value || value === zeroAddress) {
      throw new ShowmarkConfigError(`No ${name} address for chain ${this.chain.id}; pass addresses.${name} to ShowmarkClient`);
    }
    return value;
  }

  private relayOptions(): RelayOptions {
    if (!this.relay) throw new ShowmarkConfigError("No relayUrl configured; pass relayUrl to ShowmarkClient");
    return this.relay;
  }

  private async read<T>(functionName: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toReadError(functionName, error);
    }
  }

  /** The event as the registry stores it, or null when no event has this id. */
  async getEvent(eventId: bigint): Promise<ShowmarkEvent | null> {
    const registry = this.address("registry");
    try {
      const info = await this.read("eventInfo", () =>
        this.publicClient.readContract({ address: registry, abi: registryAbi, functionName: "eventInfo", args: [eventId] }),
      );
      if (info.organizer === zeroAddress) return null;
      return { id: eventId, ...info };
    } catch (error) {
      if (error instanceof ShowmarkContractError && error.revertName === "UnknownEvent") return null;
      throw error;
    }
  }

  /** True when the account, or the pass linked to it, has a recorded presence at the event. */
  async hasAttended(eventId: bigint, account: Address): Promise<boolean> {
    const registry = this.address("registry");
    return this.read("hasAttended", () =>
      this.publicClient.readContract({ address: registry, abi: registryAbi, functionName: "hasAttended", args: [eventId, account] }),
    );
  }

  /** Raw presence for a pass address. Use hasAttended when you only know the wallet. */
  async presenceOf(eventId: bigint, attendee: Address): Promise<Presence> {
    const registry = this.address("registry");
    const presence = await this.read("presenceOf", () =>
      this.publicClient.readContract({ address: registry, abi: registryAbi, functionName: "presenceOf", args: [eventId, attendee] }),
    );
    const mode = toMode(presence.mode, "presenceOf");
    return { present: mode !== 0, mode, at: presence.at };
  }

  /**
   * Current and best streak in a series. Goes through PresenceLens when its address is known, which accepts a
   * wallet or a pass; otherwise asks the registry, which expects the pass address.
   */
  async streakOf(seriesId: bigint, account: Address): Promise<Streak> {
    const lens = this.addresses.lens;
    const [current, best] =
      lens && lens !== zeroAddress
        ? await this.read("streakOf", () =>
            this.publicClient.readContract({ address: lens, abi: presenceAbi, functionName: "streakOf", args: [seriesId, account] }),
          )
        : await this.read("streakOf", () =>
            this.publicClient.readContract({ address: this.address("registry"), abi: registryAbi, functionName: "streakOf", args: [seriesId, account] }),
          );
    return { current, best };
  }

  /** How many of these events the account attended, through PresenceLens. */
  async attendedCount(account: Address, eventIds: readonly bigint[]): Promise<number> {
    const lens = this.address("lens");
    const count = await this.read("attendedCount", () =>
      this.publicClient.readContract({ address: lens, abi: presenceAbi, functionName: "attendedCount", args: [account, eventIds] }),
    );
    return Number(count);
  }

  /** The campaign as the vault stores it, or null when no campaign has this id. */
  async getCampaign(campaignId: bigint): Promise<Campaign | null> {
    const vault = this.address("vault");
    try {
      const c = await this.read("campaign", () =>
        this.publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "campaign", args: [campaignId] }),
      );
      if (c.sponsor === zeroAddress) return null;
      const minProofMode = toMode(c.minProofMode, "campaign");
      if (minProofMode === 0) throw new ShowmarkContractError({ functionName: "campaign", revertName: null, message: "campaign returned proof mode 0" });
      if (c.pricing !== 0 && c.pricing !== 1) {
        throw new ShowmarkContractError({ functionName: "campaign", revertName: null, message: `campaign returned an unknown pricing ${c.pricing}` });
      }
      return { id: campaignId, ...c, pricing: c.pricing, minProofMode };
    } catch (error) {
      if (error instanceof ShowmarkContractError && error.revertName === "UnknownCampaign") return null;
      throw error;
    }
  }

  /** What one verified presence pays right now. */
  async quote(campaignId: bigint): Promise<Quote> {
    const vault = this.address("vault");
    const [amount, priceFresh] = await this.read("quote", () =>
      this.publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "quote", args: [campaignId] }),
    );
    return { amount, priceFresh };
  }

  /** Amount the account can withdraw for a token. Zero address for native QIE. */
  async claimable(token: Address, account: Address): Promise<bigint> {
    const vault = this.address("vault");
    return this.read("claimable", () =>
      this.publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "claimable", args: [token, account] }),
    );
  }

  async relayCheckIn(data: CheckInData): Promise<RelaySubmitted> {
    return relayCheckIn(this.relayOptions(), data);
  }

  async relayCheckInBatch(items: readonly CheckInData[]): Promise<RelayBatchSubmitted> {
    return relayCheckInBatch(this.relayOptions(), items);
  }

  async relayLinkWallet(request: LinkWalletRequest): Promise<RelayTx> {
    return relayLinkWallet(this.relayOptions(), request);
  }

  async relayWithdraw(request: WithdrawRequest): Promise<RelayTx> {
    return relayWithdraw(this.relayOptions(), request);
  }

  async txStatus(hash: Hex): Promise<TxStatus> {
    return getTxStatus(this.relayOptions(), hash);
  }

  async waitForTx(hash: Hex, options?: WaitForTxOptions): Promise<TxStatus> {
    return waitForTx(this.relayOptions(), hash, options);
  }

  /** Signs CheckIn for a scanned door pass with the attendee's pass key and relays it. */
  async checkIn(params: { doorPass: DoorPassPayload | string; signer: ShowmarkSigner }): Promise<RelaySubmitted> {
    const relay = this.relayOptions();
    const data = await buildDoorPassCheckIn({ ...params, chainId: this.chain.id, registry: this.address("registry") });
    return relayCheckIn(relay, data);
  }

  /** Explorer link for a transaction on this client's chain. */
  explorerTxUrl(hash: Hex): string | null {
    return explorerTxUrl(this.chain, hash);
  }
}

export function createShowmarkClient(options: ShowmarkClientOptions): ShowmarkClient {
  return new ShowmarkClient(options);
}

