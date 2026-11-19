"use client";

import type { Address, Hex, TransactionReceipt, WalletClient } from "viem";
import { activeChain } from "@/lib/chain/chains";
import { publicClient } from "@/lib/chain/clients";
import { toPlainError, type PlainError } from "./errors";
import { executedTxHash, proposeToSafe, safeQueueUrl, type SafeCall, type SafeContext } from "./safe";

/** Who signs: a connected wallet, or the Safe this page is running inside. */
export type Signer =
  | { kind: "wallet"; account: Address; client: WalletClient }
  | { kind: "safe"; account: Address; ctx: SafeContext };

export type TxPhase =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "signing" }
  | { phase: "pending"; hash: Hex }
  | { phase: "proposed"; safeTxHash: Hex; queueUrl: string }
  | { phase: "success"; hash: Hex; receipt: TransactionReceipt }
  | { phase: "failed"; error: PlainError; hash?: Hex };

export type TxOutcome = { ok: true; hash: Hex; receipt: TransactionReceipt } | { ok: false };

const RECEIPT_TIMEOUT_MS = 120_000;
const SAFE_POLL_MS = 4_000;
const SAFE_POLL_LIMIT_MS = 30 * 60_000;

const TIMEOUT: PlainError = {
  message: "The network has not confirmed this transaction yet.",
  action: "Open it on the explorer to check. Do not send it again until it shows as failed.",
};

const REVERTED: PlainError = {
  message: "The transaction was mined but the vault rejected it.",
  action: "Open it on the explorer for details, then reload this page and try again.",
};

async function confirm(hash: Hex, onPhase: (p: TxPhase) => void): Promise<TxOutcome> {
  onPhase({ phase: "pending", hash });
  let receipt: TransactionReceipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  } catch {
    onPhase({ phase: "failed", error: TIMEOUT, hash });
    return { ok: false };
  }
  if (receipt.status !== "success") {
    onPhase({ phase: "failed", error: REVERTED, hash });
    return { ok: false };
  }
  onPhase({ phase: "success", hash, receipt });
  return { ok: true, hash, receipt };
}

async function waitForSafe(ctx: SafeContext, safeTxHash: Hex, onPhase: (p: TxPhase) => void): Promise<TxOutcome> {
  const started = Date.now();
  while (Date.now() - started < SAFE_POLL_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, SAFE_POLL_MS));
    let hash: Hex | null = null;
    try {
      hash = await executedTxHash(ctx, safeTxHash);
    } catch {
      // The Safe service can lag behind a fresh proposal; keep the proposal state and ask again.
      continue;
    }
    if (hash) return confirm(hash, onPhase);
  }
  // Still waiting for owners: the proposed state stays on screen with its queue link.
  return { ok: false };
}

/**
 * Sends calls and reports every phase. A wallet sends exactly one call, simulated first so a revert shows plain
 * copy before any popup. A Safe receives all calls as one proposal and executes them atomically once the owners
 * confirm.
 */
export async function runCalls(signer: Signer, calls: readonly SafeCall[], onPhase: (p: TxPhase) => void): Promise<TxOutcome> {
  try {
    if (signer.kind === "safe") {
      onPhase({ phase: "signing" });
      const safeTxHash = await proposeToSafe(signer.ctx, calls);
      onPhase({ phase: "proposed", safeTxHash, queueUrl: safeQueueUrl(signer.ctx) });
      return await waitForSafe(signer.ctx, safeTxHash, onPhase);
    }

    if (calls.length !== 1) throw new Error("A wallet sends one call at a time");
    const [call] = calls as [SafeCall];
    onPhase({ phase: "checking" });
    await publicClient.call({ account: signer.account, to: call.to, data: call.data, value: call.value });
    onPhase({ phase: "signing" });
    const hash = await signer.client.sendTransaction({
      account: signer.account,
      chain: activeChain,
      to: call.to,
      data: call.data,
      value: call.value,
    });
    return await confirm(hash, onPhase);
  } catch (error) {
    onPhase({ phase: "failed", error: toPlainError(error) });
    return { ok: false };
  }
}

export function isBusy(p: TxPhase): boolean {
  return p.phase === "checking" || p.phase === "signing" || p.phase === "pending" || p.phase === "proposed";
}
