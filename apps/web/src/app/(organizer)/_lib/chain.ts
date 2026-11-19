import { getAbiItem, zeroAddress, type Address, type Hex } from "viem";
import { registryAbi, vaultAbi } from "@/lib/chain/abi";
import { addresses } from "@/lib/chain/addresses";
import { publicClient } from "@/lib/chain/clients";

// Direct chain reads for the organizer console and the door screen. Presence and money come from the chain; the API
// adds names and metadata on top.

export interface ChainEvent {
  organizer: Address;
  startsAt: bigint;
  endsAt: bigint;
  capacity: number;
  checkedIn: number;
  maxPassAge: number;
  seriesId: bigint;
  seriesIndex: number;
}

/** The registry's record of an event, or null when no event has this id. */
export async function readEvent(eventId: bigint): Promise<ChainEvent | null> {
  const info = await publicClient.readContract({ address: addresses.registry, abi: registryAbi, functionName: "eventInfo", args: [eventId] });
  if (info.organizer === zeroAddress) return null;
  return info;
}

export async function readDoorKeyValidUntil(eventId: bigint, key: Address): Promise<bigint> {
  return publicClient.readContract({ address: addresses.registry, abi: registryAbi, functionName: "doorKeyValidUntil", args: [eventId, key] });
}

export async function readLatestBlockTimestamp(): Promise<bigint> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return block.timestamp;
}

export interface ClaimableBalance {
  token: Address;
  symbol: "QIE" | "QUSDC";
  amount: bigint;
}

/** What the vault holds for this account right now, ready to withdraw. */
export async function readClaimable(account: Address): Promise<ClaimableBalance[]> {
  const tokens: { token: Address; symbol: "QIE" | "QUSDC" }[] = [{ token: zeroAddress, symbol: "QIE" }];
  if (addresses.qusdc !== zeroAddress) tokens.push({ token: addresses.qusdc, symbol: "QUSDC" });
  return Promise.all(
    tokens.map(async (t) => ({
      ...t,
      amount: await publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "claimable", args: [t.token, account] }),
    })),
  );
}

export interface PresenceRecord {
  attendee: Address;
  mode: 1 | 2;
  doorKey: Address;
  doorTime: bigint;
  streak: number;
  block: bigint;
  tx: Hex;
}

export interface PayoutRecord {
  campaignId: bigint;
  attendee: Address;
  toOrganizer: bigint;
  toAttendee: bigint;
  gross: bigint;
  block: bigint;
  tx: Hex;
}

export interface EventLedger {
  presences: PresenceRecord[];
  payouts: PayoutRecord[];
  fromBlock: bigint;
  toBlock: bigint;
}

const checkedInEvent = getAbiItem({ abi: registryAbi, name: "CheckedIn" });
const settledEvent = getAbiItem({ abi: vaultAbi, name: "Settled" });
/** QIE RPC nodes answer at most 10,000 blocks per eth_getLogs call. */
const LOG_RANGE = 10_000n;

/**
 * Every check-in and every payout for one event, read from the chain logs. Starts at the block that created the
 * event, since nothing about it can be older. viem splits the range into calls the RPC accepts.
 */
export async function readEventLedger(eventId: bigint, createdTx: Hex): Promise<EventLedger> {
  const [receipt, head] = await Promise.all([publicClient.getTransactionReceipt({ hash: createdTx }), publicClient.getBlockNumber()]);
  const fromBlock = receipt.blockNumber;
  const [checkIns, settlements] = await Promise.all([
    publicClient.getLogs({ address: addresses.registry, event: checkedInEvent, args: { eventId }, fromBlock, toBlock: head, blockRange: LOG_RANGE }),
    publicClient.getLogs({ address: addresses.vault, event: settledEvent, args: { eventId }, fromBlock, toBlock: head, blockRange: LOG_RANGE }),
  ]);
  const presences: PresenceRecord[] = [];
  for (const log of checkIns) {
    const a = log.args;
    if (!a.attendee || a.mode === undefined || !a.doorKey || a.doorTime === undefined || log.blockNumber === null || !log.transactionHash) continue;
    presences.push({
      attendee: a.attendee,
      mode: a.mode === 2 ? 2 : 1,
      doorKey: a.doorKey,
      doorTime: a.doorTime,
      streak: a.streak ?? 0,
      block: log.blockNumber,
      tx: log.transactionHash,
    });
  }
  const payouts: PayoutRecord[] = [];
  for (const log of settlements) {
    const a = log.args;
    if (a.campaignId === undefined || !a.attendee || a.toOrganizer === undefined || a.toAttendee === undefined || a.gross === undefined) continue;
    if (log.blockNumber === null || !log.transactionHash) continue;
    payouts.push({
      campaignId: a.campaignId,
      attendee: a.attendee,
      toOrganizer: a.toOrganizer,
      toAttendee: a.toAttendee,
      gross: a.gross,
      block: log.blockNumber,
      tx: log.transactionHash,
    });
  }
  return { presences, payouts, fromBlock, toBlock: head };
}
