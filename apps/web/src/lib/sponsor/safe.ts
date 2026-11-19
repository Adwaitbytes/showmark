"use client";

import SafeAppsSDK, { type SafeInfo } from "@safe-global/safe-apps-sdk";
import { getAddress, type Address, type Hex } from "viem";
import { activeChainId } from "@/lib/chain/chains";

// Safe App support. When /sponsor is opened inside safe.qie.digital, the Safe is the sponsor: every write is
// proposed to the Safe as one batch (approve and createCampaign together, which a plain wallet cannot do) and the
// owners confirm it in the Safe's queue. Outside an iframe none of this runs.

const SAFE_ORIGINS = [/^https:\/\/safe\.qie\.digital$/, /^https:\/\/safe-testnet\.qie\.digital$/];
const SAFE_APP_URL = { 1990: "https://safe.qie.digital", 1983: "https://safe-testnet.qie.digital" } as const;
const DETECT_TIMEOUT_MS = 1_500;

export interface SafeContext {
  sdk: SafeAppsSDK;
  safe: Address;
  chainId: number;
  threshold: number;
  owners: Address[];
  /** Chain short name used in Safe URLs, for example "qie" in qie:0xabc. */
  shortName: string | null;
}

export interface SafeCall {
  to: Address;
  data: Hex;
  value: bigint;
}

let detection: Promise<SafeContext | null> | null = null;

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top throws, which itself means we are framed.
    return true;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function detect(): Promise<SafeContext | null> {
  if (typeof window === "undefined" || !inIframe()) return null;
  const sdk = new SafeAppsSDK({ allowedDomains: SAFE_ORIGINS, debug: false });
  // The SDK never resolves outside a Safe host, so a short timeout decides.
  const info: SafeInfo | null = await withTimeout(sdk.safe.getInfo(), DETECT_TIMEOUT_MS);
  if (!info) return null;
  const chain = await withTimeout(sdk.safe.getChainInfo(), DETECT_TIMEOUT_MS);
  return {
    sdk,
    safe: getAddress(info.safeAddress),
    chainId: Number(info.chainId),
    threshold: info.threshold,
    owners: info.owners.map((o) => getAddress(o)),
    shortName: chain?.shortName ?? null,
  };
}

/** Resolves once per page load: the Safe context when running as a Safe App, otherwise null. */
export function detectSafe(): Promise<SafeContext | null> {
  detection ??= detect().catch(() => null);
  return detection;
}

export function safeOnWrongChain(ctx: SafeContext): boolean {
  return ctx.chainId !== activeChainId;
}

/** Proposes one or more calls as a single Safe transaction. Returns the safeTxHash. */
export async function proposeToSafe(ctx: SafeContext, calls: readonly SafeCall[]): Promise<Hex> {
  const { safeTxHash } = await ctx.sdk.txs.send({
    txs: calls.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
  });
  return safeTxHash as Hex;
}

/** The chain transaction hash once the Safe has executed the proposal, or null while it waits for signatures. */
export async function executedTxHash(ctx: SafeContext, safeTxHash: Hex): Promise<Hex | null> {
  const details = await ctx.sdk.txs.getBySafeTxHash(safeTxHash);
  return details.txHash ? (details.txHash as Hex) : null;
}

export function safeQueueUrl(ctx: SafeContext): string {
  const base = SAFE_APP_URL[ctx.chainId === 1990 ? 1990 : 1983];
  const prefix = ctx.shortName ? `${ctx.shortName}:` : "";
  return `${base}/transactions/queue?safe=${prefix}${ctx.safe}`;
}
