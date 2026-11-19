"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Hex, TransactionReceipt } from "viem";
import type { ErrorCopy } from "../_lib/api";
import { describeTxError, quoteRegistryCall, sendRegistryCall, TxError, type GasQuote, type RegistryCall, type TxErrorCopy } from "../_lib/tx";

export type TxPhase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "pending"; hash: Hex }
  | { kind: "done"; hash: Hex; receipt: TransactionReceipt }
  | { kind: "failed"; error: TxErrorCopy; hash: Hex | null };

/** One registry transaction from the organizer's wallet, as a state a component can render. */
export function useRegistryTx() {
  const [phase, setPhase] = useState<TxPhase>({ kind: "idle" });

  const run = useCallback(async (call: RegistryCall, account: Address): Promise<TransactionReceipt | null> => {
    setPhase({ kind: "signing" });
    let sent: Hex | null = null;
    try {
      const receipt = await sendRegistryCall(call, account, (hash) => {
        sent = hash;
        setPhase({ kind: "pending", hash });
      });
      setPhase({ kind: "done", hash: receipt.transactionHash, receipt });
      return receipt;
    } catch (error) {
      setPhase({ kind: "failed", error: describeTxError(error, account), hash: sent });
      return null;
    }
  }, []);

  const reset = useCallback(() => setPhase({ kind: "idle" }), []);
  return { phase, run, reset, busy: phase.kind === "signing" || phase.kind === "pending" };
}

export type QuoteState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; quote: GasQuote } | { kind: "failed"; error: ErrorCopy };

/** Estimates a call's gas cost for the connected wallet whenever the call changes. `key` identifies the call. */
export function useGasQuote(key: string | null, call: RegistryCall | null, account: Address | null): QuoteState {
  const [result, setResult] = useState<{ key: string; state: QuoteState } | null>(null);
  useEffect(() => {
    if (!key || !call || !account) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      quoteRegistryCall(call, account)
        .then((quote) => {
          if (!cancelled) setResult({ key, state: { kind: "ready", quote } });
        })
        .catch((error: unknown) => {
          if (!cancelled) setResult({ key, state: { kind: "failed", error: error instanceof TxError ? error.copy : describeTxError(error, account) } });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `call` is described by `key`; re-running on every new object would spam the RPC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, account]);
  if (!key || !call || !account) return { kind: "idle" };
  return result && result.key === key ? result.state : { kind: "loading" };
}
