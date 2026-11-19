"use client";

import { useEffect, useMemo, useState } from "react";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { registryAbi } from "@/lib/chain/abi";
import { addresses } from "@/lib/chain/addresses";
import { publicClient } from "@/lib/chain/clients";
import { readJson, writeJson, browserStorage, type KeyValueStorage } from "./storage";
import { useStoredItem } from "./use-stored";

// Which wallet a pass is linked to. The index can lag the chain by 15 to 45 seconds, so right after
// linking, /pass/withdraw used to say "link a wallet first". Now three sources answer, best first:
// the registry itself (walletOf, read live), then the wallet this phone just linked (remembered when
// the link transaction confirmed), then the API's index.

export const LINKED_KEY = "showmark.linked.v1";

type LinkedRecord = Record<string, { wallet: Address; at: number }>;

function readLinked(storage: KeyValueStorage | null): LinkedRecord {
  const value = readJson(storage, LINKED_KEY);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: LinkedRecord = {};
  for (const [pass, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { wallet, at } = entry as { wallet?: unknown; at?: unknown };
    if (typeof wallet === "string" && isAddress(wallet, { strict: false }) && typeof at === "number") out[pass.toLowerCase()] = { wallet: getAddress(wallet), at };
  }
  return out;
}

/** Called once the link transaction is mined, so the next screen knows before the index does. */
export function rememberLinkedWallet(pass: Address, wallet: Address, storage: KeyValueStorage | null = browserStorage()): void {
  writeJson(storage, LINKED_KEY, { ...readLinked(storage), [pass.toLowerCase()]: { wallet: getAddress(wallet), at: Date.now() } });
}

export function rememberedWallet(pass: Address, storage: KeyValueStorage | null = browserStorage()): Address | null {
  return readLinked(storage)[pass.toLowerCase()]?.wallet ?? null;
}

/** walletOf(pass) on the registry, read now. Null when unlinked. Throws when the chain cannot be read. */
export async function readWalletOf(pass: Address): Promise<Address | null> {
  const wallet = await publicClient.readContract({ address: addresses.registry, abi: registryAbi, functionName: "walletOf", args: [pass] });
  return wallet === zeroAddress ? null : getAddress(wallet);
}

/** Picks the answer: the chain when it answered, else this phone's memory, else the index. */
export function resolveLinkedWallet(chain: Address | null | undefined, remembered: Address | null, indexed: Address | null): Address | null {
  if (chain !== undefined) return chain;
  return remembered ?? indexed;
}

export interface LinkedWalletState {
  wallet: Address | null;
  /** True until the chain has answered or failed, while a remembered or indexed answer may already show. */
  checking: boolean;
}

/**
 * The wallet linked to `pass`. `indexed` is what the passport API said (pass null while loading).
 * `refreshKey` reads the chain again, for example when the screen is retried.
 */
export function useLinkedWallet(pass: Address | null | undefined, indexed: Address | null, refreshKey: unknown = null): LinkedWalletState {
  const rawRemembered = useStoredItem(LINKED_KEY);
  const remembered = useMemo(() => (pass && rawRemembered ? rememberedWallet(pass) : null), [pass, rawRemembered]);
  const [chain, setChain] = useState<{ pass: Address; wallet: Address | null | "error" } | null>(null);

  useEffect(() => {
    if (!pass || addresses.registry === zeroAddress) return;
    let cancelled = false;
    readWalletOf(pass)
      .then((wallet) => {
        if (!cancelled) setChain({ pass, wallet });
      })
      .catch(() => {
        // An unreachable RPC falls back to this phone's memory and the index.
        if (!cancelled) setChain({ pass, wallet: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [pass, refreshKey]);

  const current = chain && pass && chain.pass === pass ? chain.wallet : undefined;
  return {
    wallet: resolveLinkedWallet(current === "error" ? undefined : current, remembered, indexed),
    checking: Boolean(pass) && current === undefined && addresses.registry !== zeroAddress,
  };
}
