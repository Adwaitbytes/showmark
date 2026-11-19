import { inArray } from "drizzle-orm";
import { after } from "next/server";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { chainContext, contractsDeployed } from "../chain";
import { getDatabase } from "../db/client";
import * as t from "../db/schema";
import { requireRelayerPrivateKey } from "../env";
import { AppError, COMMON_ERRORS } from "../errors";
import { getStore } from "../kv";
import { log } from "../log";
import { openCampaignIds, payingCampaignIds } from "../payouts";
import { challengesAfterSettlement, dbLookup, directoryLookup, liveOptedInCampaigns, type ClaimLookup } from "./claims";
import { readRelayDirectory } from "./directory";
import { doorQueueId } from "./door-queue";
import { DEFAULT_RELAY_OPTIONS, type RelayerDeps } from "./queue";
import type { RelayerChain } from "./sender";

// Wires the relayer to production config: the key from RELAYER_PRIVATE_KEY, the shared chain client, Upstash and
// Neon. Tests and the anvil integration build RelayerDeps directly instead.

let cachedAccount: { key: Hex; account: PrivateKeyAccount } | null = null;

function account(): PrivateKeyAccount {
  const key = requireRelayerPrivateKey();
  if (!cachedAccount || cachedAccount.key !== key) cachedAccount = { key, account: privateKeyToAccount(key) };
  return cachedAccount.account;
}

export function relayerChain(): RelayerChain {
  const ctx = chainContext();
  if (!contractsDeployed(ctx)) throw new AppError(503, COMMON_ERRORS.notDeployed);
  return { chainId: ctx.chainId, client: ctx.client, account: account(), registry: ctx.registry, vault: ctx.vault, bond: ctx.bond };
}

interface SettlementPlanner {
  paying(eventId: bigint): Promise<bigint[]>;
  open: bigint[];
  lookup: ClaimLookup;
}

export function relayerDeps(): RelayerDeps {
  const chain = relayerChain();
  const kv = getStore();
  let plan: Promise<SettlementPlanner> | null = null;
  const planner = () =>
    (plan ??= (async (): Promise<SettlementPlanner> => {
      const dir = await readRelayDirectory(kv, chain.chainId);
      if (dir) {
        return {
          paying: async (eventId) => (dir.events[eventId.toString()]?.campaigns ?? []).map(BigInt),
          open: dir.open.map(BigInt),
          lookup: directoryLookup(chain, dir),
        };
      }
      log.warn("relayer.directory_missing", { chainId: chain.chainId });
      const { db } = getDatabase();
      return { paying: (eventId) => payingCampaignIds(db, eventId), open: await openCampaignIds(db), lookup: dbLookup(chain, db) };
    })());
  return {
    chain,
    kv,
    // Settlement planning reads the relay directory from Redis (one round trip). Only when it has never been
    // published does it fall back to Postgres; this all runs after the check-in has already been answered.
    async campaignsFor(eventId) {
      const plan = await planner();
      const indexed = await plan.paying(eventId);
      const live = await liveOptedInCampaigns(chain, plan.lookup, eventId, plan.open.filter((id) => !indexed.includes(id)));
      return [...indexed, ...live];
    },
    async challengesAfter(items) {
      const plan = await planner();
      return challengesAfterSettlement(chain, plan.lookup, items, new Set(plan.open));
    },
    async onSent(items, txHash) {
      // Only door-scans-you attestations pass through the door queue.
      const ids = items.filter((d) => d.mode === 2).map(doorQueueId);
      if (ids.length === 0) return;
      await getDatabase().db.update(t.doorQueue).set({ submittedTx: txHash }).where(inArray(t.doorQueue.id, ids));
    },
    // Settlement, claim refreshes and the balance check run after the response, still under the relayer lock.
    background: (task) => after(task),
    options: DEFAULT_RELAY_OPTIONS,
    now: Date.now,
  };
}
