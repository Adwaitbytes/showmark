"use client";

import { useState } from "react";
import { encodeFunctionData } from "viem";
import { erc20Abi, vaultAbi } from "@/lib/chain/abi";
import { addresses } from "@/lib/chain/addresses";
import { parseAmount, refundOpensAt } from "@/lib/sponsor/math";
import type { SafeCall } from "@/lib/sponsor/safe";
import { isBusy, runCalls, type TxPhase } from "@/lib/sponsor/tx";
import { useHoldings, type OnChainCampaign } from "@/lib/sponsor/use-chain";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/Field";
import { formatDate, formatTime, type TokenSymbol } from "@/ui/format";
import { Notice } from "@/ui/Notice";
import { amountText } from "./campaign";
import type { SponsorSeat } from "./SponsorGate";
import { TxStatus } from "./TxStatus";

const DECIMALS: Record<TokenSymbol, number> = { QIE: 18, QUSDC: 6 };

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-rule-soft pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-md font-medium text-ink">{title}</h3>
      {children}
    </div>
  );
}

function TopUp({ id, symbol, seat, onDone }: { id: bigint; symbol: TokenSymbol; seat: SponsorSeat; onDone: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [approve, setApprove] = useState<TxPhase>({ phase: "idle" });
  const [fund, setFund] = useState<TxPhase>({ phase: "idle" });
  const holdings = useHoldings(seat.account);
  const amount = parseAmount(input, DECIMALS[symbol]);
  const allowance = holdings.status === "ready" ? (holdings.value.allowance ?? 0n) : 0n;
  const needsApproval = symbol === "QUSDC" && amount !== null && amount > allowance && approve.phase !== "success";

  const topUpCall = (value: bigint): SafeCall => ({
    to: addresses.vault,
    data: encodeFunctionData({ abi: vaultAbi, functionName: "topUp", args: [id, value] }),
    value: symbol === "QIE" ? value : 0n,
  });
  const approveCall = (value: bigint): SafeCall => ({
    to: addresses.qusdc,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [addresses.vault, value] }),
    value: 0n,
  });

  function check(): bigint | null {
    if (amount === null || amount === 0n) {
      setError(`Enter an amount of ${symbol} above zero, with at most ${DECIMALS[symbol]} decimal places.`);
      return null;
    }
    setError(undefined);
    return amount;
  }

  async function send() {
    const value = check();
    if (value === null) return;
    const calls = seat.safe && needsApproval ? [approveCall(value), topUpCall(value)] : [topUpCall(value)];
    const outcome = await runCalls(seat.signer, calls, setFund);
    if (outcome.ok) {
      setInput("");
      setApprove({ phase: "idle" });
      holdings.reload();
      onDone();
    }
  }

  async function sendApprove() {
    const value = check();
    if (value === null) return;
    const outcome = await runCalls(seat.signer, [approveCall(value)], setApprove);
    if (outcome.ok) holdings.reload();
  }

  return (
    <div className="flex flex-col gap-3">
      <TextField
        id="topup"
        label={`Add ${symbol} to the escrow`}
        inputMode="decimal"
        mono
        placeholder={symbol === "QIE" ? "500" : "100"}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setFund({ phase: "idle" });
        }}
        error={error}
        hint={holdings.status === "ready" ? `${seat.safe ? "The Safe" : "Your wallet"} holds ${amountText(symbol === "QIE" ? holdings.value.native : (holdings.value.qusdc ?? 0n), symbol)}.` : undefined}
        fieldClassName="max-w-xs"
      />
      <div className="flex flex-wrap gap-3">
        {needsApproval && !seat.safe ? (
          <Button variant="secondary" onClick={() => void sendApprove()} pending={isBusy(approve)}>
            Approve {input} QUSDC
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => void send()} pending={isBusy(fund)} disabled={needsApproval && !seat.safe}>
          {seat.safe ? "Propose top up" : "Top up"}
        </Button>
      </div>
      <TxStatus phase={approve} via={seat.signer.kind} successText="Approved for the vault" />
      <TxStatus phase={fund} via={seat.signer.kind} successText="Added to the escrow" />
    </div>
  );
}

/** Sponsor-only controls: top up, close early, refund. Each maps to one vault function and says what it does first. */
export function ManageCampaign({
  id,
  symbol,
  chain,
  now,
  seat,
  onChanged,
}: {
  id: string;
  symbol: TokenSymbol;
  chain: OnChainCampaign;
  now: number;
  seat: SponsorSeat;
  onChanged: () => void;
}) {
  const [close, setClose] = useState<TxPhase>({ phase: "idle" });
  const [confirmClose, setConfirmClose] = useState(false);
  const [refund, setRefund] = useState<TxPhase>({ phase: "idle" });
  const campaignId = BigInt(id);
  const ended = now > chain.endsAt;
  const opensAt = refundOpensAt(chain.endsAt);
  const opensIso = new Date(opensAt * 1000).toISOString();
  const refundOpen = now >= opensAt;

  async function sendClose() {
    const outcome = await runCalls(
      seat.signer,
      [{ to: addresses.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "closeCampaign", args: [campaignId] }), value: 0n }],
      setClose,
    );
    setConfirmClose(false);
    if (outcome.ok) onChanged();
  }

  async function sendRefund() {
    const outcome = await runCalls(
      seat.signer,
      [{ to: addresses.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: "refund", args: [campaignId] }), value: 0n }],
      setRefund,
    );
    if (outcome.ok) onChanged();
  }

  return (
    <div className="flex flex-col gap-6">
      {!ended ? (
        <Block title="Top up">
          <TopUp id={campaignId} symbol={symbol} seat={seat} onDone={onChanged} />
        </Block>
      ) : null}

      {!ended ? (
        <Block title="Close early">
          <p className="text-sm text-ink-soft">
            Stops paying for check-ins from now on. People already checked in can still be paid during the 3 day grace period, then the
            rest comes back to you.
          </p>
          {confirmClose ? (
            <div className="flex flex-col gap-3 rounded-doc bg-paper-deep px-4 py-3.5">
              <p className="text-sm font-medium text-ink">Close campaign #{id} now? This cannot be undone.</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => void sendClose()} pending={isBusy(close)}>
                  {seat.safe ? "Propose closing" : "Yes, close it"}
                </Button>
                <Button variant="quiet" onClick={() => setConfirmClose(false)} disabled={isBusy(close)}>
                  Keep it running
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="quiet" className="text-vermilion-ink" onClick={() => setConfirmClose(true)}>
                Close early
              </Button>
            </div>
          )}
          <TxStatus phase={close} via={seat.signer.kind} successText="Campaign closed" />
        </Block>
      ) : null}

      <Block title="Refund unspent budget">
        {chain.balance === 0n ? (
          <p className="text-sm text-ink-soft">Nothing is left in escrow, so there is nothing to refund.</p>
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              {refundOpen
                ? `${amountText(chain.balance, symbol)} is waiting. The refund goes to ${seat.safe ? "this Safe" : "this wallet"}.`
                : `${amountText(chain.balance, symbol)} is still in escrow. The refund opens on ${formatDate(opensIso)} at ${formatTime(opensIso)}, three days after the campaign ends, so late check-ins can still be paid. Refunds work even if Showmark is paused.`}
            </p>
            {refundOpen ? (
              <div>
                <Button variant="primary" disabled={refund.phase === "success"} pending={isBusy(refund)} onClick={() => void sendRefund()}>
                  {`Refund ${amountText(chain.balance, symbol)}`}
                </Button>
              </div>
            ) : (
              <p className="text-base text-ink">
                Refund opens <span className="font-mono">{formatDate(opensIso)}</span>
              </p>
            )}
          </>
        )}
        <TxStatus phase={refund} via={seat.signer.kind} successText="Refunded" />
      </Block>

      {seat.safe ? (
        <Notice tone="info">Every action here is proposed to the Safe and runs once the owners confirm it.</Notice>
      ) : null}
    </div>
  );
}
