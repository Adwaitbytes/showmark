import { encodeFunctionData, getAddress, zeroAddress, type Address } from "viem";
import { bondAbi, registryAbi, vaultAbi } from "@/lib/chain/abi";
import type { Db } from "../db/client";
import { and, eq } from "drizzle-orm";
import * as t from "../db/schema";
import type { RelayerChain, TxRequest } from "./sender";
import type { RelayDirectory } from "./directory";
import type { SettleItem } from "./settle";

// Audit I4-01 (operational rule): a challenge's claim on an organizer's bond is the campaign's bonded exposure when
// the challenge was filed. Every bonded payout after that raises the exposure, so after any settlement that may
// have paid through bonded open eligibility the relayer calls bond.refreshClaim(challengeId) right behind it,
// and the cron sweeps every open challenge whose claim is below the live exposure.

export const REFRESH_CLAIM_GAS = 150_000n;
/** How far back the on-chain fallback looks for a challenge id when the index does not have it yet. */
const CHALLENGE_SCAN = 200n;

export function refreshClaimRequest(chain: RelayerChain, challengeId: bigint): TxRequest {
  return {
    to: chain.bond,
    data: encodeFunctionData({ abi: bondAbi, functionName: "refreshClaim", args: [challengeId] }),
    gas: REFRESH_CLAIM_GAS,
    label: `refreshClaim(${challengeId})`,
  };
}

/** Where the relayer learns an event's organizer and a known open challenge id: the Redis directory or Postgres. */
export interface ClaimLookup {
  organizerOf(eventId: bigint): Promise<Address>;
  indexedChallenge(campaignId: bigint, organizer: Address): Promise<bigint | null>;
}

async function chainOrganizer(chain: RelayerChain, eventId: bigint): Promise<Address> {
  const info = await chain.client.readContract({ address: chain.registry, abi: registryAbi, functionName: "eventInfo", args: [eventId] });
  return info.organizer;
}

/** Lookups from Postgres (cron, tests). */
export function dbLookup(chain: RelayerChain, db: Db): ClaimLookup {
  return {
    async organizerOf(eventId) {
      const [row] = await db.select({ organizer: t.events.organizer }).from(t.events).where(eq(t.events.id, eventId)).limit(1);
      return row ? getAddress(row.organizer) : chainOrganizer(chain, eventId);
    },
    async indexedChallenge(campaignId, organizer) {
      const [row] = await db
        .select({ id: t.challenges.id })
        .from(t.challenges)
        .where(and(eq(t.challenges.campaignId, campaignId), eq(t.challenges.organizer, organizer.toLowerCase()), eq(t.challenges.resolved, false)))
        .limit(1);
      return row?.id ?? null;
    },
  };
}

/** Lookups from the relay directory in Redis, so the check-in path never touches Postgres. */
export function directoryLookup(chain: RelayerChain, dir: RelayDirectory): ClaimLookup {
  return {
    async organizerOf(eventId) {
      const known = dir.events[eventId.toString()]?.organizer;
      return known ? getAddress(known) : chainOrganizer(chain, eventId);
    },
    async indexedChallenge(campaignId, organizer) {
      const hit = dir.challenges.find((c) => c.campaignId === campaignId.toString() && c.organizer === organizer.toLowerCase());
      return hit ? BigInt(hit.id) : null;
    },
  };
}

/** The open challenge id for (campaign, organizer): from the lookup (confirmed on chain), else the newest on chain. */
async function openChallengeId(chain: RelayerChain, lookup: ClaimLookup, campaignId: bigint, organizer: Address): Promise<bigint | null> {
  const known = await lookup.indexedChallenge(campaignId, organizer);
  if (known !== null) {
    const c = await chain.client.readContract({ address: chain.bond, abi: bondAbi, functionName: "challengeOf", args: [known] });
    if (!c.resolved) return known;
  }
  const next = await chain.client.readContract({ address: chain.bond, abi: bondAbi, functionName: "nextChallengeId" });
  for (let id = next - 1n; id >= 1n && id >= next - CHALLENGE_SCAN; id--) {
    const c = await chain.client.readContract({ address: chain.bond, abi: bondAbi, functionName: "challengeOf", args: [id] });
    if (!c.resolved && c.campaignId === campaignId && c.organizer.toLowerCase() === organizer.toLowerCase()) return id;
  }
  return null;
}

/**
 * Open campaigns the event's organizer opted into, checked live on the vault so a fresh opt-in is honoured before
 * the index sees it.
 */
export async function liveOptedInCampaigns(chain: RelayerChain, lookup: ClaimLookup, eventId: bigint, openCampaigns: bigint[]): Promise<bigint[]> {
  if (openCampaigns.length === 0) return [];
  const organizer = await lookup.organizerOf(eventId);
  const flags = await Promise.all(
    openCampaigns.map((id) => chain.client.readContract({ address: chain.vault, abi: vaultAbi, functionName: "optedIn", args: [id, organizer] })),
  );
  return openCampaigns.filter((_, i) => flags[i]);
}

/**
 * Challenges to refresh after settling `items`: for each open campaign in the batch whose event organizer has an
 * open challenge on that campaign. Approved-event payouts never touch bonded exposure, so they are skipped.
 */
export async function challengesAfterSettlement(chain: RelayerChain, lookup: ClaimLookup, items: SettleItem[], openCampaigns: ReadonlySet<bigint>): Promise<bigint[]> {
  if (chain.bond === zeroAddress) return [];
  const pairs = new Map<string, { campaignId: bigint; eventId: bigint }>();
  for (const item of items) if (openCampaigns.has(item.campaignId)) pairs.set(`${item.campaignId}:${item.eventId}`, item);
  const ids = new Set<bigint>();
  const seen = new Set<string>();
  for (const { campaignId, eventId } of pairs.values()) {
    const organizer = await lookup.organizerOf(eventId);
    const key = `${campaignId}:${organizer.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const open = await chain.client.readContract({ address: chain.bond, abi: bondAbi, functionName: "hasOpenChallenge", args: [campaignId, organizer] });
    if (!open) continue;
    const id = await openChallengeId(chain, lookup, campaignId, organizer);
    if (id !== null) ids.add(id);
  }
  return [...ids];
}

/** For the cron: open challenges whose claim is below the campaign's live bonded exposure for that organizer. */
export async function staleChallenges(chain: RelayerChain, db: Db): Promise<bigint[]> {
  if (chain.bond === zeroAddress) return [];
  const rows = await db.select({ id: t.challenges.id }).from(t.challenges).where(eq(t.challenges.resolved, false));
  const out: bigint[] = [];
  for (const { id } of rows) {
    const c = await chain.client.readContract({ address: chain.bond, abi: bondAbi, functionName: "challengeOf", args: [id] });
    if (c.resolved) continue;
    const exposure = await chain.client.readContract({ address: chain.vault, abi: vaultAbi, functionName: "exposureOf", args: [c.campaignId, c.organizer] });
    if (exposure > c.claim) out.push(id);
  }
  return out;
}
