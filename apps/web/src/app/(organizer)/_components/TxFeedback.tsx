"use client";

import type { Address } from "viem";
import { activeChain } from "@/lib/chain/chains";
import { CopyButton } from "@/ui/CopyButton";
import { Notice } from "@/ui/Notice";
import { TxLink } from "@/ui/TxLink";
import { formatQie } from "../_lib/tx";
import type { QuoteState, TxPhase } from "./use-registry-tx";

/** One line under a transaction button: what it costs, or why it cannot be sent. */
export function GasLine({ quote, account }: { quote: QuoteState; account: Address | null }) {
  if (quote.kind === "idle") return null;
  if (quote.kind === "loading") {
    return (
      <p className="text-sm text-ink-soft" aria-live="polite">
        Working out the gas fee…
      </p>
    );
  }
  if (quote.kind === "failed") {
    return (
      <Notice tone="warning" title={quote.error.message}>
        {quote.error.action}
      </Notice>
    );
  }
  const { cost, balance, enough } = quote.quote;
  if (!enough && account) return <NeedsGas account={account} cost={formatQie(cost)} balance={formatQie(balance)} />;
  return (
    <p className="text-sm text-ink-soft">
      Your wallet pays a gas fee of about <span className="font-mono text-ink">{formatQie(cost)} QIE</span>. You have{" "}
      <span className="font-mono">{formatQie(balance)} QIE</span>.
    </p>
  );
}

export function NeedsGas({ account, cost, balance }: { account: Address; cost?: string; balance?: string }) {
  return (
    <Notice tone="warning" title="You need a little QIE for gas">
      <p>
        {cost ? (
          <>
            This step costs about <span className="font-mono">{cost} QIE</span>
          </>
        ) : (
          <>This step costs a small amount of QIE</>
        )}
        {balance !== undefined ? (
          <>
            {" "}
            and this wallet has <span className="font-mono">{balance} QIE</span>
          </>
        ) : null}
        .{" "}
        {activeChain.testnet ? (
          <>
            Get free test QIE at{" "}
            <a className="text-stamp-blue underline underline-offset-4" href="https://www.qie.digital/faucet" target="_blank" rel="noopener noreferrer">
              qie.digital/faucet
            </a>
            , then try again.
          </>
        ) : (
          <>Send a little QIE to this wallet from an exchange or a friend’s wallet, then try again.</>
        )}
      </p>
      <p className="mt-2 flex items-center gap-1 font-mono text-sm break-all text-ink">
        {account}
        <CopyButton value={account} what="wallet address" />
      </p>
    </Notice>
  );
}

/** The life of a sent transaction: waiting for the wallet, waiting for the chain, done or failed. */
export function TxProgress({ phase, account, doneTitle }: { phase: TxPhase; account: Address | null; doneTitle: string }) {
  if (phase.kind === "idle") return null;
  if (phase.kind === "signing") {
    return <Notice title="Confirm in QIE Wallet">Check the details in your wallet and approve the transaction.</Notice>;
  }
  if (phase.kind === "pending") {
    return (
      <Notice title="Sent. Waiting for the chain">
        This usually takes a few seconds. <TxLink hash={phase.hash}>View on the explorer</TxLink>
      </Notice>
    );
  }
  if (phase.kind === "done") {
    return (
      <Notice tone="success" title={doneTitle}>
        <TxLink hash={phase.hash}>View the transaction on the explorer</TxLink>
      </Notice>
    );
  }
  if (phase.error.needsGas && account) {
    return <NeedsGas account={account} cost={phase.error.gasCost} />;
  }
  return (
    <Notice tone="danger" title={phase.error.message}>
      {phase.error.action}
      {phase.hash ? (
        <>
          {" "}
          <TxLink hash={phase.hash}>View on the explorer</TxLink>
        </>
      ) : null}
    </Notice>
  );
}
