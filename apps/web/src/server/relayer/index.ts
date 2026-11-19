import { inArray } from "drizzle-orm";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { chainContext, contractsDeployed } from "../chain";
import { getDatabase } from "../db/client";
import * as t from "../db/schema";
import { requireRelayerPrivateKey } from "../env";
import { AppError, COMMON_ERRORS } from "../errors";
import { getStore } from "../kv";
import { payingCampaignIds } from "../payouts";
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
  return { chainId: ctx.chainId, client: ctx.client, account: account(), registry: ctx.registry, vault: ctx.vault };
}

export function relayerDeps(): RelayerDeps {
  const chain = relayerChain();
  const kv = getStore();
  return {
    chain,
    kv,
    campaignsFor: (eventId) => payingCampaignIds(getDatabase().db, eventId),
    async onSent(items, txHash) {
      // Only door-scans-you attestations pass through the door queue.
      const ids = items.filter((d) => d.mode === 2).map(doorQueueId);
      if (ids.length === 0) return;
      await getDatabase().db.update(t.doorQueue).set({ submittedTx: txHash }).where(inArray(t.doorQueue.id, ids));
    },
    options: DEFAULT_RELAY_OPTIONS,
    now: Date.now,
  };
}
