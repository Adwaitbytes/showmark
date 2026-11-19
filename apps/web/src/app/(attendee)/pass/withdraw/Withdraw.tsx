"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { getPassport, linkedWalletOf, postWithdraw, waitForTx, type PassportData } from "@/lib/checkin/api-passport";
import { localizedError, type Copy } from "@/lib/checkin/i18n";
import { useLocale } from "@/lib/checkin/locale";
import { usePassAddress } from "@/lib/checkin/use-stored";
import { AddressChip } from "@/ui/AddressChip";
import { Amount } from "@/ui/Amount";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { RetryIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, SkeletonText } from "@/ui/Skeleton";
import { TxLink } from "@/ui/TxLink";
import { WalletIcon } from "../../_components/icons";

type Load = { status: "loading" } | { status: "ready"; passport: PassportData } | { status: "failed"; copy: Copy };

type RowState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "confirming"; txHash: Hex }
  | { kind: "done"; txHash: Hex }
  | { kind: "error"; copy: Copy; txHash?: Hex };

export function Withdraw() {
  const { t, errors } = useLocale();
  const passAddress = usePassAddress();
  const hydrated = passAddress !== undefined;
  const pass = passAddress ?? null;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!pass) return;
    const controller = new AbortController();
    getPassport(pass, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setLoad({ status: "ready", passport: result.data });
      else {
        const english = result.failure.message && result.failure.action ? { message: result.failure.message, action: result.failure.action } : t.pass.loadFailed;
        setLoad({ status: "failed", copy: localizedError(result.failure.code, english, errors?.api ?? null) });
      }
    });
    return () => controller.abort();
  }, [pass, reloadKey, errors, t]);

  if (hydrated && !pass) {
    return (
      <ErrorState as="h2" title={t.link.noPass.message} action={<Button href="/scan" variant="primary">{t.pass.scanCta}</Button>}>
        {t.link.noPass.action}
      </ErrorState>
    );
  }

  if (!hydrated || load.status === "loading" || !pass) {
    return (
      <LoadingRegion label={t.common.loading}>
        <SkeletonText lines={4} />
      </LoadingRegion>
    );
  }

  if (load.status === "failed") {
    return (
      <ErrorState
        as="h2"
        title={load.copy.message}
        action={
          <Button
            variant="quiet"
            onClick={() => {
              setLoad({ status: "loading" });
              setReloadKey((k) => k + 1);
            }}
            leading={<RetryIcon className="size-4" />}
          >
            {t.common.retry}
          </Button>
        }
      >
        {load.copy.action}
      </ErrorState>
    );
  }

  const wallet = linkedWalletOf(load.passport, pass);
  if (!wallet) {
    return (
      <ErrorState
        as="h2"
        title={t.withdraw.needsLink.message}
        action={
          <Button href="/pass/link" variant="primary" leading={<WalletIcon className="size-5" />}>
            {t.checkIn.linkNow}
          </Button>
        }
      >
        {t.withdraw.needsLink.action}
      </ErrorState>
    );
  }

  const owed = load.passport.claimable.filter((c) => BigInt(c.amount) > BigInt(0) || rows[c.token]?.kind === "done");
  if (owed.length === 0) {
    return <EmptyState title={t.withdraw.nothing} action={<Button href="/pass">{t.common.backToPassport}</Button>} />;
  }

  async function withdraw(token: Address, account: Address) {
    setRows((r) => ({ ...r, [token]: { kind: "sending" } }));
    const result = await postWithdraw({ token, account });
    if (!result.ok) {
      const english = result.failure.message && result.failure.action ? { message: result.failure.message, action: result.failure.action } : t.withdraw.failed;
      setRows((r) => ({ ...r, [token]: { kind: "error", copy: localizedError(result.failure.code, english, errors?.api ?? null) } }));
      return;
    }
    const { txHash } = result.data;
    setRows((r) => ({ ...r, [token]: { kind: "confirming", txHash } }));
    const outcome = await waitForTx(txHash, new AbortController().signal);
    setRows((r) => ({
      ...r,
      [token]: outcome === "success" ? { kind: "done", txHash } : { kind: "error", copy: outcome === "reverted" ? t.withdraw.failed : t.withdraw.slow, txHash },
    }));
  }

  const remaining = owed.filter((c) => {
    const kind = rows[c.token]?.kind;
    return kind !== "done" && kind !== "sending" && kind !== "confirming";
  });
  const busy = owed.some((c) => rows[c.token]?.kind === "sending" || rows[c.token]?.kind === "confirming");

  async function withdrawAll() {
    if (!pass) return;
    // One at a time: the relayer serializes its nonce anyway, and each result shows as it lands.
    for (const c of remaining) await withdraw(c.token, pass);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-base text-ink-soft">
        <span>{t.withdraw.sendsTo}</span>
        <AddressChip address={wallet} name={load.passport.qieName} />
      </div>
      <Sheet>
        <SheetSection className="flex flex-col gap-5">
          <ul className="flex flex-col divide-y divide-rule-soft">
            {owed.map((c) => {
              const row = rows[c.token] ?? { kind: "idle" };
              return (
                <li key={c.token} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <Amount value={c.amount} symbol={c.symbol} className={row.kind === "done" ? "text-xl text-ink-soft" : "text-xl text-ink"} />
                    <span className="text-sm text-ink-soft" aria-live="polite">
                      {row.kind === "done" ? t.withdraw.done : row.kind === "sending" ? t.withdraw.sending : row.kind === "confirming" ? t.withdraw.confirming : ""}
                    </span>
                  </div>
                  {row.kind === "done" || row.kind === "confirming" ? <TxLink hash={row.txHash}>{t.common.explorer}</TxLink> : null}
                  {row.kind === "error" ? (
                    <Notice tone="danger" title={row.copy.message} action={row.txHash ? <TxLink hash={row.txHash}>{t.common.explorer}</TxLink> : null}>
                      {row.copy.action}
                    </Notice>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {remaining.length > 0 || busy ? (
            <Button variant="primary" size="lg" block pending={busy} onClick={() => void withdrawAll()}>
              {remaining.length === 1 ? t.withdraw.submit(remaining[0].symbol) : t.withdraw.submitAll}
            </Button>
          ) : (
            <Button href="/pass" variant="secondary" size="lg" block>
              {t.common.backToPassport}
            </Button>
          )}
        </SheetSection>
      </Sheet>
    </div>
  );
}
