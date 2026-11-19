"use client";

import { useState } from "react";
import { encodeFunctionData, parseEventLogs, type TransactionReceipt } from "viem";
import { erc20Abi, vaultAbi } from "@/lib/chain/abi";
import { addresses } from "@/lib/chain/addresses";
import { dexAvailable } from "@/lib/sponsor/dex";
import type { CampaignDraft } from "@/lib/sponsor/form";
import type { SafeCall } from "@/lib/sponsor/safe";
import { isBusy, runCalls, type TxPhase } from "@/lib/sponsor/tx";
import { useHoldings } from "@/lib/sponsor/use-chain";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { CheckIcon, RetryIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";
import { Skeleton } from "@/ui/Skeleton";
import { amountText } from "./campaign";
import { DexFund } from "./DexFund";
import type { SponsorSeat } from "./SponsorGate";
import { TxStatus } from "./TxStatus";

function approveCall(draft: CampaignDraft): SafeCall {
  return {
    to: addresses.qusdc,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [addresses.vault, draft.deposit] }),
    value: 0n,
  };
}

function createCall(draft: CampaignDraft): SafeCall {
  return {
    to: addresses.vault,
    data: encodeFunctionData({ abi: vaultAbi, functionName: "createCampaign", args: [draft.params, draft.deposit] }),
    value: draft.token === "QIE" ? draft.deposit : 0n,
  };
}

export function campaignIdFrom(receipt: TransactionReceipt): string | null {
  const [created] = parseEventLogs({ abi: vaultAbi, eventName: "CampaignCreated", logs: receipt.logs });
  return created ? created.args.campaignId.toString() : null;
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-pill font-mono text-sm",
          done ? "bg-ledger-green text-paper" : "shadow-[inset_0_0_0_1.5px_var(--ink)] text-ink",
        )}
      >
        {done ? <CheckIcon className="size-4" /> : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
        <h3 className="text-base font-medium text-ink">
          <span className="sr-only">Step {n}{done ? ", done" : ""}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

/**
 * The deposit, step by step. Native QIE: one createCampaign with the deposit as value. QUSDC: approve exactly the
 * deposit, then createCampaign. Inside a Safe both go out as one proposal, so there is never a dangling approval.
 */
export function FundingSteps({ draft, seat, onCreated }: { draft: CampaignDraft; seat: SponsorSeat; onCreated: (id: string | null, hash: string) => void }) {
  const holdings = useHoldings(seat.account);
  const [approve, setApprove] = useState<TxPhase>({ phase: "idle" });
  const [create, setCreate] = useState<TxPhase>({ phase: "idle" });
  const depositText = amountText(draft.deposit, draft.token);

  if (holdings.status === "loading") {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">Checking your balance</span>
        <Skeleton className="h-5 w-60" />
        <Skeleton className="h-11 w-48" />
      </div>
    );
  }
  if (holdings.status === "error") {
    return (
      <Notice
        tone="danger"
        title="Your balance could not be read from the QIE network."
        action={
          <Button variant="quiet" onClick={holdings.reload} leading={<RetryIcon className="size-4" />}>
            Check again
          </Button>
        }
      >
        Check your connection and try again. Nothing has been sent.
      </Notice>
    );
  }

  const { native, qusdc, allowance } = holdings.value;
  const via = seat.signer.kind;

  async function sendCreate(calls: SafeCall[]) {
    const outcome = await runCalls(seat.signer, calls, setCreate);
    if (outcome.ok) onCreated(campaignIdFrom(outcome.receipt), outcome.hash);
  }

  if (draft.token === "QIE") {
    const short = native < draft.deposit;
    return (
      <ol className="flex flex-col gap-6">
        <Step n={1} title={`Create the campaign and deposit ${depositText}`} done={create.phase === "success"}>
          {short ? (
            <Notice tone="warning" title={`This ${seat.safe ? "Safe" : "wallet"} holds ${amountText(native, "QIE")}`}>
              The deposit is {depositText}, plus a network fee of about 0.0002 QIE. Add QIE or lower the deposit.
            </Notice>
          ) : null}
          <div>
            <Button variant="primary" disabled={short || create.phase === "success"} pending={isBusy(create)} onClick={() => void sendCreate([createCall(draft)])}>
              {seat.safe ? "Propose to the Safe" : `Deposit ${depositText}`}
            </Button>
          </div>
          <TxStatus phase={create} via={via} successText="Campaign created and funded" />
        </Step>
      </ol>
    );
  }

  const balance = qusdc ?? 0n;
  const shortfall = draft.deposit > balance ? draft.deposit - balance : 0n;
  const approved = (allowance ?? 0n) >= draft.deposit || approve.phase === "success";

  if (seat.safe) {
    const calls = approved ? [createCall(draft)] : [approveCall(draft), createCall(draft)];
    return (
      <ol className="flex flex-col gap-6">
        {shortfall > 0n ? (
          <Step n={1} title={`Get ${amountText(shortfall, "QUSDC")} more into the Safe`} done={false}>
            {dexAvailable() ? (
              <DexFund shortfall={shortfall} signer={seat.signer} onSwapped={holdings.reload} />
            ) : (
              <Notice tone="warning" title={`The Safe holds ${amountText(balance, "QUSDC")}`}>
                Send QUSDC to the Safe, then check again.
              </Notice>
            )}
          </Step>
        ) : null}
        <Step n={shortfall > 0n ? 2 : 1} title={`Approve and deposit ${depositText} in one Safe transaction`} done={create.phase === "success"}>
          <p className="text-sm text-ink-soft">
            The Safe runs {approved ? "createCampaign" : "approve for exactly the deposit, then createCampaign"} together, so
            no approval is ever left open.
          </p>
          <div>
            <Button variant="primary" disabled={shortfall > 0n || create.phase === "success"} pending={isBusy(create)} onClick={() => void sendCreate(calls)}>
              Propose to the Safe
            </Button>
          </div>
          <TxStatus phase={create} via="safe" successText="Campaign created and funded" />
        </Step>
      </ol>
    );
  }

  let n = 0;
  return (
    <ol className="flex flex-col gap-6">
      {shortfall > 0n ? (
        <Step n={++n} title={`Get ${amountText(shortfall, "QUSDC")} more`} done={false}>
          <p className="text-sm text-ink-soft">
            This wallet holds {amountText(balance, "QUSDC")} and the deposit is {depositText}.
          </p>
          {dexAvailable() ? (
            <DexFund shortfall={shortfall} signer={seat.signer} onSwapped={holdings.reload} />
          ) : (
            <Notice tone="warning" title="Add QUSDC to this wallet">
              QUSDC and QIEDEX exist on QIE Mainnet only. Send QUSDC to this wallet, then check again.
            </Notice>
          )}
          <div>
            <Button variant="quiet" onClick={holdings.reload} leading={<RetryIcon className="size-4" />}>
              Check balance again
            </Button>
          </div>
        </Step>
      ) : null}
      <Step n={++n} title={`Let the vault take exactly ${depositText}`} done={approved}>
        {approved && approve.phase !== "success" ? (
          <p className="text-sm text-ink-soft">Already approved. The vault can take {depositText} from this wallet.</p>
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              An approval for the deposit amount only, never an unlimited one. The vault pulls it in the next step.
            </p>
            <div>
              <Button
                variant="secondary"
                disabled={shortfall > 0n || approve.phase === "success"}
                pending={isBusy(approve)}
                onClick={() => void runCalls(seat.signer, [approveCall(draft)], setApprove).then(() => holdings.reload())}
              >
                Approve {depositText}
              </Button>
            </div>
          </>
        )}
        <TxStatus phase={approve} via={via} successText={`Approved ${depositText} for the vault`} />
      </Step>
      <Step n={++n} title={`Create the campaign and deposit ${depositText}`} done={create.phase === "success"}>
        <div>
          <Button variant="primary" disabled={!approved || shortfall > 0n || create.phase === "success"} pending={isBusy(create)} onClick={() => void sendCreate([createCall(draft)])}>
            Deposit {depositText}
          </Button>
        </div>
        <TxStatus phase={create} via={via} successText="Campaign created and funded" />
      </Step>
    </ol>
  );
}
