"use client";

import { useCallback, useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { aggregatorAbi, erc20Abi } from "@/lib/chain/abi";
import { addresses } from "@/lib/chain/addresses";
import { publicClient } from "@/lib/chain/clients";
import { vaultSponsorAbi } from "./abi";

// Live reads straight from the chain for numbers that move: the oracle price, the vault's fee snapshot source,
// balances and allowances. Nothing here is cached server side, so what the sponsor sees is what the vault sees.

export type Read<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error" };

export interface OraclePrice {
  answer: bigint;
  decimals: number;
  updatedAt: number;
}

/** Latest QIE/USD round. Re-read every minute. */
export function useOraclePrice(): Read<OraclePrice> & { reload: () => void } {
  const [state, setState] = useState<Read<OraclePrice>>(() => (addresses.qieUsdOracle === zeroAddress ? { status: "error" } : { status: "loading" }));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (addresses.qieUsdOracle === zeroAddress) return;
    let live = true;
    async function read() {
      try {
        const [round, decimals] = await Promise.all([
          publicClient.readContract({ address: addresses.qieUsdOracle, abi: aggregatorAbi, functionName: "latestRoundData" }),
          publicClient.readContract({ address: addresses.qieUsdOracle, abi: aggregatorAbi, functionName: "decimals" }),
        ]);
        if (live) setState({ status: "ready", value: { answer: round[1], decimals, updatedAt: Number(round[3]) } });
      } catch {
        if (live) setState({ status: "error" });
      }
    }
    void read();
    const timer = setInterval(read, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export interface VaultConfig {
  feeBps: number;
  maxOracleAge: number;
}

/** The fee new campaigns snapshot, and the oldest oracle price the vault accepts. */
export function useVaultConfig(): Read<VaultConfig> {
  const [state, setState] = useState<Read<VaultConfig>>(() => (addresses.vault === zeroAddress ? { status: "error" } : { status: "loading" }));
  useEffect(() => {
    if (addresses.vault === zeroAddress) return;
    let live = true;
    Promise.all([
      publicClient.readContract({ address: addresses.vault, abi: vaultSponsorAbi, functionName: "feeBps" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultSponsorAbi, functionName: "maxOracleAge" }),
    ])
      .then(([feeBps, maxOracleAge]) => {
        if (live) setState({ status: "ready", value: { feeBps, maxOracleAge: Number(maxOracleAge) } });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export interface Holdings {
  native: bigint;
  qusdc: bigint | null;
  allowance: bigint | null;
}

/** Native and QUSDC balances of `owner`, and its QUSDC allowance to the vault. */
export async function readHoldings(owner: Address): Promise<Holdings> {
  const native = await publicClient.getBalance({ address: owner });
  if (addresses.qusdc === zeroAddress) return { native, qusdc: null, allowance: null };
  const [qusdc, allowance] = await Promise.all([
    publicClient.readContract({ address: addresses.qusdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    publicClient.readContract({ address: addresses.qusdc, abi: erc20Abi, functionName: "allowance", args: [owner, addresses.vault] }),
  ]);
  return { native, qusdc, allowance };
}

export function useHoldings(owner: Address | null): Read<Holdings> & { reload: () => void } {
  const [state, setState] = useState<Read<Holdings>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!owner) return;
    let live = true;
    readHoldings(owner)
      .then((value) => {
        if (live) setState({ status: "ready", value });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [owner, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export interface OnChainCampaign {
  sponsor: Address;
  token: Address;
  pricing: number;
  attendeeShareBps: number;
  feeBps: number;
  minProofMode: number;
  requireQieId: boolean;
  openToBonded: boolean;
  maxPerEvent: number;
  maxTotal: number;
  settledCount: number;
  startsAt: number;
  endsAt: number;
  amountPerPresence: bigint;
  minBond: bigint;
  balance: bigint;
}

/** The vault's own record of a campaign: the source of truth for balance, end time and caps. */
export function useOnChainCampaign(id: string): Read<OnChainCampaign> & { reload: () => void } {
  const readable = addresses.vault !== zeroAddress && /^\d+$/.test(id);
  const [state, setState] = useState<Read<OnChainCampaign>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!readable) return;
    let live = true;
    publicClient
      .readContract({ address: addresses.vault, abi: vaultSponsorAbi, functionName: "campaign", args: [BigInt(id)] })
      .then((c) => {
        if (!live) return;
        setState({
          status: "ready",
          value: {
            ...c,
            startsAt: Number(c.startsAt),
            endsAt: Number(c.endsAt),
          },
        });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [id, nonce, readable]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return readable ? { ...state, reload } : { status: "error", reload };
}

/** Current unix time in seconds, ticking every `everyMs`. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
