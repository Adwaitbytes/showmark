"use client";

import { useEffect, useState } from "react";
import { ApiRequestError } from "@/lib/sponsor/api";
import { buildSwap, DEFAULT_SLIPPAGE_BPS, fetchQuote, HIGH_IMPACT_PCT, UnsafeSwapError, type DexQuote } from "@/lib/sponsor/dex";
import { runCalls, type Signer, type TxPhase } from "@/lib/sponsor/tx";
import { Button } from "@/ui/Button";
import { formatTokenAmount } from "@/ui/format";
import { RetryIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { Notice } from "@/ui/Notice";
import { Skeleton } from "@/ui/Skeleton";
import { TxStatus } from "./TxStatus";

type QuoteState = { status: "loading" } | { status: "ready"; quote: DexQuote } | { status: "error"; message: string; action: string };

/**
 * Buys the QUSDC a deposit is missing with native QIE through QIEDEX (mainnet only). Shows the worst case the sponsor
 * can pay and the price impact up front, because the QIE/QUSDC pool is thin.
 */
export function DexFund({ shortfall, signer, onSwapped }: { shortfall: bigint; signer: Signer; onSwapped: () => void }) {
  const [nonce, setNonce] = useState(0);
  const key = `${shortfall}:${nonce}`;
  const [answer, setAnswer] = useState<{ key: string; state: QuoteState } | null>(null);
  // A quote for an older amount or an older refresh counts as still loading.
  const quote: QuoteState = answer && answer.key === key ? answer.state : { status: "loading" };
  const [phase, setPhase] = useState<TxPhase>({ phase: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    const requestKey = `${shortfall}:${nonce}`;
    fetchQuote(shortfall, DEFAULT_SLIPPAGE_BPS, controller.signal)
      .then((q) => setAnswer({ key: requestKey, state: { status: "ready", quote: q } }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const copy = error instanceof ApiRequestError ? error.copy : { message: "QIEDEX did not return a price.", action: "Try again in a minute." };
        setAnswer({ key: requestKey, state: { status: "error", ...copy } });
      });
    return () => controller.abort();
  }, [shortfall, nonce]);

  async function swap(q: DexQuote) {
    const maxIn = q.maxAmountIn ?? q.amountIn;
    setPhase({ phase: "checking" });
    let call;
    try {
      call = await buildSwap(signer.account, shortfall, DEFAULT_SLIPPAGE_BPS, maxIn);
    } catch (error) {
      const unsafe = error instanceof UnsafeSwapError;
      setPhase({
        phase: "failed",
        error: unsafe
          ? { message: "QIEDEX returned a swap that did not match the quote, so Showmark did not send it.", action: "Get a fresh price and try again." }
          : { message: "QIEDEX could not build the swap just now.", action: "Try again in a minute." },
      });
      return;
    }
    const outcome = await runCalls(signer, [call], setPhase);
    if (outcome.ok) onSwapped();
  }

  const shortText = `${formatTokenAmount(shortfall.toString(), "QUSDC")} QUSDC`;

  return (
    <div className="flex flex-col gap-4 rounded-doc px-4 py-4 shadow-[inset_0_0_0_1px_var(--rule-soft)]">
      <div className="flex flex-col gap-1">
        <h4 className="text-base font-medium text-ink">Buy the missing {shortText} with QIE on QIEDEX</h4>
        <p className="text-sm text-ink-soft">One swap through the official QIEDEX router, paid from this wallet, before the deposit.</p>
      </div>
      {quote.status === "loading" ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Getting a price from QIEDEX</span>
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : null}
      {quote.status === "error" ? (
        <Notice
          tone="danger"
          title={quote.message}
          action={
            <Button variant="quiet" onClick={() => setNonce((n) => n + 1)} leading={<RetryIcon className="size-4" />}>
              Get a price again
            </Button>
          }
        >
          {quote.action}
        </Notice>
      ) : null}
      {quote.status === "ready" ? (
        <>
          <Ledger label="QIEDEX swap">
            <LedgerRow label="You receive" value={shortText} />
            <LedgerRow label="Expected cost" value={`${formatTokenAmount(quote.quote.amountIn.toString(), "QIE")} QIE`} />
            <LedgerRow
              label="Most you can pay"
              value={`${formatTokenAmount((quote.quote.maxAmountIn ?? quote.quote.amountIn).toString(), "QIE")} QIE`}
              note={`With ${quote.quote.slippageBps / 100} percent slippage allowed. If the price moves more than that, the swap fails and nothing is spent but the network fee.`}
            />
            <LedgerRow label="Price impact" value={`${quote.quote.priceImpactPct.toFixed(2)}%`} note="How much this trade moves the pool price, before the 0.3 percent pool fee" />
          </Ledger>
          {quote.quote.priceImpactPct > HIGH_IMPACT_PCT ? (
            <Notice tone="warning" title={`This swap moves the price by ${quote.quote.priceImpactPct.toFixed(1)} percent`}>
              The QIE and QUSDC pool on QIEDEX is small, so large swaps cost noticeably more than the market price. Consider a smaller
              deposit now and a top up later, or fund the campaign in native QIE.
            </Notice>
          ) : null}
          {quote.quote.warnings
            .filter((w) => w.severity !== "info")
            .map((w) => (
              <Notice key={w.code} tone={w.severity === "danger" ? "danger" : "warning"}>
                QIEDEX says: {w.message}
              </Notice>
            ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void swap(quote.quote)} pending={phase.phase === "checking" || phase.phase === "signing" || phase.phase === "pending"}>
              Swap QIE for {shortText}
            </Button>
            <Button variant="quiet" onClick={() => setNonce((n) => n + 1)} leading={<RetryIcon className="size-4" />}>
              Refresh price
            </Button>
          </div>
          <TxStatus phase={phase} via={signer.kind} successText={`Bought ${shortText}`} />
        </>
      ) : null}
    </div>
  );
}
