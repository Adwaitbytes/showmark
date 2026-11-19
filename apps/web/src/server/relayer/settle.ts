import { encodeFunctionData, type Address } from "viem";
import { vaultAbi } from "@/lib/chain/abi";
import type { RelayerChain, TxRequest } from "./sender";

export interface SettleItem {
  campaignId: bigint;
  eventId: bigint;
  attendee: Address;
}

// settleBatch is sent right behind the check-in with the next nonce, before the check-in is mined. Estimating gas
// against current state would see "not present" and short-circuit, so the limit is computed per item instead.
// A paid item touches the presence, event, campaign, up to three claimable slots, caps and possibly the oracle and
// Zone: about 150k gas when every slot is new. Unused gas is not charged, so the limit is generous.
export const SETTLE_GAS_BASE = 80_000n;
export const SETTLE_GAS_PER_ITEM = 200_000n;
export const MAX_SETTLE_ITEMS_PER_TX = 100;

export function settleGasLimit(items: number): bigint {
  return SETTLE_GAS_BASE + SETTLE_GAS_PER_ITEM * BigInt(items);
}

/** One settleBatch transaction per 100 items. */
export function settleRequests(chain: RelayerChain, items: SettleItem[]): TxRequest[] {
  const out: TxRequest[] = [];
  for (let i = 0; i < items.length; i += MAX_SETTLE_ITEMS_PER_TX) {
    const slice = items.slice(i, i + MAX_SETTLE_ITEMS_PER_TX);
    out.push({
      to: chain.vault,
      data: encodeFunctionData({ abi: vaultAbi, functionName: "settleBatch", args: [slice] }),
      gas: settleGasLimit(slice.length),
      label: `settleBatch(${slice.length})`,
    });
  }
  return out;
}

/** Every (campaign, attendee) pair for the attendees just checked in to `eventId`. */
export function settleItemsFor(eventId: bigint, attendees: Address[], campaignIds: bigint[]): SettleItem[] {
  const out: SettleItem[] = [];
  for (const campaignId of campaignIds) for (const attendee of attendees) out.push({ campaignId, eventId, attendee });
  return out;
}
