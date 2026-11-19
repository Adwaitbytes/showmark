"use client";

import type { TxPhase } from "@/lib/sponsor/tx";
import { cn } from "@/ui/cn";
import { CheckIcon, ExternalIcon } from "@/ui/icons";
import { TxLink } from "@/ui/TxLink";

export interface TxStatusProps {
  phase: TxPhase;
  /** Who signs: changes the wording of the signing step. */
  via: "wallet" | "safe";
  /** What a success means, said as a result: "Approved 500 QUSDC for the vault". */
  successText: string;
  className?: string;
}

function Dot({ tone }: { tone: "wait" | "ok" | "bad" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-[0.55em] size-2 shrink-0 rotate-45",
        tone === "wait" && "animate-ink-wait bg-stamp-blue",
        tone === "ok" && "bg-ledger-green",
        tone === "bad" && "bg-vermilion-ink",
      )}
    />
  );
}

/** One transaction's progress in plain words, with the explorer link as soon as there is a hash. */
export function TxStatus({ phase, via, successText, className }: TxStatusProps) {
  if (phase.phase === "idle") return null;

  let body: React.ReactNode;
  let tone: "wait" | "ok" | "bad" = "wait";
  switch (phase.phase) {
    case "checking":
      body = <p>Checking with the vault before anything opens in your wallet.</p>;
      break;
    case "signing":
      body = <p>{via === "safe" ? "Review and submit the proposal in the Safe window." : "Confirm the request in QIE Wallet."}</p>;
      break;
    case "pending":
      body = (
        <p>
          Sent. Waiting for the network, which usually takes under 10 seconds. <TxLink hash={phase.hash} />
        </p>
      );
      break;
    case "proposed":
      body = (
        <p>
          Proposed to the Safe. It runs once enough owners confirm it, and this page updates when it does.{" "}
          <a
            href={phase.queueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-stamp-blue underline decoration-stamp-blue/35 underline-offset-4 hover:decoration-stamp-blue"
          >
            Open the Safe queue
            <ExternalIcon className="size-3.5" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      );
      break;
    case "success":
      tone = "ok";
      body = (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            <CheckIcon className="size-4 self-center text-ledger-green" />
            {successText}
          </span>
          <TxLink hash={phase.hash} />
        </p>
      );
      break;
    case "failed":
      tone = "bad";
      body = (
        <div className="flex flex-col gap-0.5">
          <p className="font-medium text-ink">{phase.error.message}</p>
          <p className="text-ink-soft">
            {phase.error.action} {phase.hash ? <TxLink hash={phase.hash} /> : null}
          </p>
        </div>
      );
      break;
  }

  return (
    <div role={tone === "bad" ? "alert" : "status"} aria-live="polite" className={cn("flex gap-3 text-sm text-ink-soft", className)}>
      <Dot tone={tone} />
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}
