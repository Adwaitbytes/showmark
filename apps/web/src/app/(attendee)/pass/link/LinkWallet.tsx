"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { getPassport, linkedWalletOf, postLinkWallet, waitForTx, type PassportData } from "@/lib/checkin/api-passport";
import { localizedError, type Copy } from "@/lib/checkin/i18n";
import { useLocale } from "@/lib/checkin/locale";
import { linkDeadlineFromNow, linkWalletTypedData } from "@/lib/checkin/sign";
import { connect, useWallet, walletClient } from "@/lib/wallet/use-wallet";
import { parsePassKey, PASS_STORAGE_KEY } from "@/lib/checkin/pass-key";
import { usePassAddress, useStoredItem } from "@/lib/checkin/use-stored";
import { privateKeyToAccount } from "viem/accounts";
import { toWalletError } from "@/lib/wallet/wallet-store";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { ErrorState } from "@/ui/ErrorState";
import { RetryIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, SkeletonText } from "@/ui/Skeleton";
import { TxLink } from "@/ui/TxLink";
import { WalletIcon } from "../../_components/icons";

const QIE_WALLET_URL = "https://qiewallet.me";

type Step =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "submitting" }
  | { kind: "confirming"; txHash: Hex }
  | { kind: "linked"; txHash: Hex; wallet: Address }
  | { kind: "error"; copy: Copy; txHash?: Hex };

type PassportLoad = { status: "loading" } | { status: "ready"; passport: PassportData } | { status: "failed" };
/** What the index says about the connected wallet. Anything older than the current wallet reads as "checking". */
type WalletCheck = { wallet: Address; status: "free" | "taken" | "failed" };

export function LinkWallet() {
  const { t, errors } = useLocale();
  const passAddress = usePassAddress();
  const hydrated = passAddress !== undefined;
  const rawPass = useStoredItem(PASS_STORAGE_KEY);
  const wallet = useWallet();
  const checkboxId = useId();
  // A viem account for the pass, rebuilt whenever the stored pass changes (see use-stored.ts).
  const pass = useMemo(() => {
    const key = parsePassKey(rawPass ?? null);
    return key ? privateKeyToAccount(key) : null;
  }, [rawPass]);
  const [passport, setPassport] = useState<PassportLoad>({ status: "loading" });
  const [walletCheck, setWalletCheck] = useState<WalletCheck | null>(null);
  const [moveStamps, setMoveStamps] = useState(true);
  const [step, setStep] = useState<Step>({ kind: "idle" });

  useEffect(() => {
    if (!pass) return;
    const controller = new AbortController();
    getPassport(pass.address, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setPassport(result.ok ? { status: "ready", passport: result.data } : { status: "failed" });
    });
    return () => controller.abort();
  }, [pass]);

  // Each wallet links to one pass. Ask the index before asking for signatures that would be rejected.
  const connected = wallet.status === "connected" ? wallet.account : null;
  useEffect(() => {
    if (!connected || !pass) return;
    const controller = new AbortController();
    getPassport(connected, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setWalletCheck({ status: "failed", wallet: connected });
        return;
      }
      const other = result.data.pass;
      const taken = other !== null && result.data.wallet !== null && other.toLowerCase() !== pass.address.toLowerCase();
      setWalletCheck({ status: taken ? "taken" : "free", wallet: connected });
    });
    return () => controller.abort();
  }, [connected, pass]);

  if (!hydrated || (pass && passport.status === "loading")) {
    return (
      <LoadingRegion label={t.common.loading}>
        <SkeletonText lines={4} />
      </LoadingRegion>
    );
  }

  if (!pass) {
    return (
      <ErrorState
        as="h2"
        title={t.link.noPass.message}
        action={
          <Button href="/scan" variant="primary">
            {t.pass.scanCta}
          </Button>
        }
      >
        {t.link.noPass.action}
      </ErrorState>
    );
  }

  const existing = passport.status === "ready" ? linkedWalletOf(passport.passport, pass.address) : null;
  if (existing && step.kind !== "linked") {
    return (
      <Notice tone="success" title={t.link.alreadyLinked} action={<Button href="/pass">{t.common.backToPassport}</Button>}>
        <AddressChip address={existing} name={passport.status === "ready" ? passport.passport.qieName : null} />
      </Notice>
    );
  }

  if (step.kind === "linked") {
    return (
      <Notice
        tone="success"
        title={t.link.linkedTitle}
        action={
          <div className="flex flex-wrap items-center gap-4">
            <Button href="/pass" variant="secondary">
              {t.common.backToPassport}
            </Button>
            <TxLink hash={step.txHash}>{t.common.explorer}</TxLink>
          </div>
        }
      >
        {t.link.linkedBody}
      </Notice>
    );
  }

  const check = connected && walletCheck?.wallet === connected ? walletCheck.status : "checking";
  const stampIds = passport.status === "ready" ? passport.passport.stamps.map((s) => s.eventId) : [];

  async function link() {
    if (!pass || !connected) return;
    const client = walletClient();
    if (!client) return;
    setStep({ kind: "signing" });
    const typed = linkWalletTypedData({ pass: pass.address, wallet: connected, deadline: linkDeadlineFromNow() });
    let passSig: Hex;
    let walletSig: Hex;
    try {
      passSig = await pass.signTypedData(typed);
      walletSig = await client.signTypedData({ account: connected, ...typed });
    } catch (error) {
      const e = toWalletError(error);
      setStep({ kind: "error", copy: localizedError(e.code, e, errors?.wallet ?? null) });
      return;
    }
    setStep({ kind: "submitting" });
    const result = await postLinkWallet({
      pass: pass.address,
      wallet: connected,
      deadline: typed.message.deadline.toString(),
      passSig,
      walletSig,
      relocateEventIds: moveStamps ? stampIds : [],
    });
    if (!result.ok) {
      const english = result.failure.message && result.failure.action ? { message: result.failure.message, action: result.failure.action } : t.link.checkFailed;
      setStep({ kind: "error", copy: localizedError(result.failure.code, english, errors?.api ?? null) });
      return;
    }
    const { txHash } = result.data;
    setStep({ kind: "confirming", txHash });
    const outcome = await waitForTx(txHash, new AbortController().signal);
    if (outcome === "success") setStep({ kind: "linked", txHash, wallet: connected });
    else setStep({ kind: "error", copy: outcome === "reverted" ? t.link.reverted : t.link.slow, txHash });
  }

  const walletError = wallet.error ? localizedError(wallet.error.code, wallet.error, errors?.wallet ?? null) : null;
  const busy = step.kind === "signing" || step.kind === "submitting" || step.kind === "confirming";

  return (
    <div className="flex flex-col gap-6">
      <Sheet>
        <SheetSection className="flex flex-col gap-5">
          <ol className="flex flex-col gap-5">
            <li className="flex flex-col gap-3">
              <StepTitle n={1} done={connected !== null}>
                {t.link.step1}
              </StepTitle>
              {connected ? (
                <div className="flex flex-col gap-1.5 sm:pl-10">
                  <span className="text-sm text-ink-soft">{t.link.connectedAs}</span>
                  <AddressChip address={connected} />
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:pl-10">
                  <Button
                    variant={wallet.error?.code === "no-wallet" ? "secondary" : "primary"}
                    size="lg"
                    pending={wallet.status === "connecting" || wallet.status === "discovering"}
                    onClick={() => void connect()}
                    leading={<WalletIcon className="size-5" />}
                  >
                    {wallet.status === "wrong-chain" ? t.link.switchNetwork : t.link.connect}
                  </Button>
                  {walletError ? (
                    <Notice
                      tone="danger"
                      title={walletError.message}
                      action={
                        wallet.error?.code === "no-wallet" ? (
                          <Button href={QIE_WALLET_URL} external variant="primary">
                            {t.link.getWallet}
                          </Button>
                        ) : null
                      }
                    >
                      <p>{walletError.action}</p>
                      {wallet.error?.code === "no-wallet" ? <p className="mt-1.5">{t.link.phoneHint}</p> : null}
                    </Notice>
                  ) : null}
                </div>
              )}
            </li>

            <li className="flex flex-col gap-3">
              <StepTitle n={2} done={false}>
                {t.link.step2}
              </StepTitle>
              <div className="flex flex-col gap-4 sm:pl-10">
                <p className="text-base text-ink-soft">{t.link.signExplain}</p>
                {stampIds.length > 0 ? (
                  <label htmlFor={checkboxId} className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={moveStamps}
                      onChange={(e) => setMoveStamps(e.target.checked)}
                      className="size-5 shrink-0 accent-[var(--ink)]"
                    />
                    {t.link.moveStamps(stampIds.length)}
                  </label>
                ) : null}
                {check === "taken" ? (
                  <Notice tone="danger" title={t.link.walletTaken.message}>
                    {t.link.walletTaken.action}
                  </Notice>
                ) : check === "failed" ? (
                  <Notice tone="warning" title={t.link.checkFailed.message}>
                    {t.link.checkFailed.action}
                  </Notice>
                ) : null}
                {connected ? (
                  <Button variant="primary" size="lg" disabled={check !== "free"} pending={busy || check === "checking"} onClick={() => void link()}>
                    {step.kind === "signing" ? t.link.signing : step.kind === "submitting" || step.kind === "confirming" ? t.link.submitting : t.link.sign}
                  </Button>
                ) : (
                  <p className="text-sm text-ink-faint">{t.link.connectFirst}</p>
                )}
                {step.kind === "error" ? (
                  <Notice
                    tone="danger"
                    title={step.copy.message}
                    action={
                      <div className="flex flex-wrap items-center gap-4">
                        <Button variant="quiet" onClick={() => setStep({ kind: "idle" })} leading={<RetryIcon className="size-4" />}>
                          {t.common.retry}
                        </Button>
                        {step.txHash ? <TxLink hash={step.txHash}>{t.common.explorer}</TxLink> : null}
                      </div>
                    }
                  >
                    {step.copy.action}
                  </Notice>
                ) : null}
              </div>
            </li>
          </ol>
        </SheetSection>
      </Sheet>
      {passport.status === "failed" ? (
        <Notice tone="warning" title={t.pass.loadFailed.message}>
          {t.pass.loadFailed.action}
        </Notice>
      ) : null}
    </div>
  );
}

function StepTitle({ n, done, children }: { n: number; done: boolean; children: string }) {
  return (
    <h2 className="flex items-center gap-3 text-md font-medium text-ink">
      <span
        aria-hidden="true"
        className={
          done
            ? "grid size-7 shrink-0 place-items-center rounded-pill bg-ledger-green font-mono text-sm text-paper"
            : "grid size-7 shrink-0 place-items-center rounded-pill font-mono text-sm text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]"
        }
      >
        {n}
      </span>
      {children}
    </h2>
  );
}
