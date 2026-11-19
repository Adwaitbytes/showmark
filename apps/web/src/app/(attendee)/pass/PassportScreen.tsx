"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { getCampaignBrief, getPassport, linkedWalletOf, type PassportData } from "@/lib/checkin/api-passport";
import { localizedError } from "@/lib/checkin/i18n";
import { localStamps, mergeStamps, outboxEntries, type OutboxEntry } from "@/lib/checkin/local-records";
import { useLocale } from "@/lib/checkin/locale";
import { loadPass } from "@/lib/wallet/pass";
import { AddressChip } from "@/ui/AddressChip";
import { Amount } from "@/ui/Amount";
import { Button } from "@/ui/Button";
import { ErrorState } from "@/ui/ErrorState";
import { formatDate } from "@/ui/format";
import { RetryIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { Guilloche } from "@/ui/patterns/guilloche";
import { Perforation } from "@/ui/Perforation";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton, SkeletonStamp, SkeletonText } from "@/ui/Skeleton";
import { WalletIcon } from "../_components/icons";
import { useHydrated } from "../_components/useHydrated";
import { AttendeeCodeCard } from "./AttendeeCodeCard";
import { OutboxNotice } from "./OutboxNotice";
import { StampBooklet, type BookletEntry } from "./StampBooklet";

/** Settlement stays open this long after a campaign ends (CampaignVault SETTLE_GRACE). */
const SETTLE_GRACE_MS = 3 * 24 * 60 * 60_000;

type Fetched =
  | { status: "ready"; passport: PassportData }
  | { status: "failed"; message: string; action: string };

type Load =
  | { status: "loading" }
  | { status: "no-pass" }
  | { status: "ready"; pass: Address; passport: PassportData; entries: BookletEntry[] }
  | { status: "failed"; pass: Address; message: string; action: string };

export function PassportScreen() {
  const { t, errors } = useLocale();
  const hydrated = useHydrated();
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [deadlines, setDeadlines] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setFetched(null);
    setReloadKey((k) => k + 1);
  }, []);

  // The pass and anything saved for it live only on this phone, so they are read after hydration.
  const passAddress = useMemo(() => (hydrated ? (loadPass()?.address ?? null) : null), [hydrated]);
  const outbox = useMemo<OutboxEntry[]>(
    () => (hydrated ? outboxEntries().filter((e) => passAddress !== null && e.request.attendee.toLowerCase() === passAddress.toLowerCase()) : []),
    // reloadKey: a sent check-in leaves the outbox, so read it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, passAddress, reloadKey],
  );

  useEffect(() => {
    if (!passAddress) return;
    const controller = new AbortController();
    getPassport(passAddress, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setFetched({ status: "ready", passport: result.data });
        return;
      }
      const english = {
        message: result.failure.message ?? t.pass.loadFailed.message,
        action: result.failure.action ?? t.pass.loadFailed.action,
      };
      const copy = result.failure.kind === "api" && result.failure.message ? localizedError(result.failure.code, english, errors?.api ?? null) : t.pass.loadFailed;
      setFetched({ status: "failed", ...copy });
    });
    return () => controller.abort();
  }, [passAddress, reloadKey, errors, t]);

  const load = useMemo<Load>(() => {
    if (!hydrated) return { status: "loading" };
    if (!passAddress) return { status: "no-pass" };
    if (!fetched) return { status: "loading" };
    if (fetched.status === "failed") return { status: "failed", pass: passAddress, message: fetched.message, action: fetched.action };
    // Stamps confirmed on this phone fill in until the index has them.
    return { status: "ready", pass: passAddress, passport: fetched.passport, entries: mergeStamps(fetched.passport.stamps, localStamps(passAddress)) };
  }, [hydrated, passAddress, fetched]);

  // A "QIE ID needed" payout can still be paid until the campaign's settlement window closes.
  const pending = load.status === "ready" ? load.passport.pending : [];
  const pendingKey = pending.map((p) => p.campaignId).join(",");
  useEffect(() => {
    const ids = [...new Set(pendingKey.split(",").filter(Boolean))];
    if (ids.length === 0) return;
    const controller = new AbortController();
    Promise.all(ids.map((id) => getCampaignBrief(id, { signal: controller.signal }))).then((results) => {
      if (controller.signal.aborted) return;
      const next: Record<string, string> = {};
      results.forEach((r, i) => {
        if (r.ok) next[ids[i]] = new Date(Date.parse(r.data.endsAt) + SETTLE_GRACE_MS).toISOString();
      });
      setDeadlines(next);
    });
    return () => controller.abort();
  }, [pendingKey]);

  const pass = load.status === "ready" || load.status === "failed" ? load.pass : null;
  const passport = load.status === "ready" ? load.passport : null;
  const wallet = passport && pass ? linkedWalletOf(passport, pass) : null;
  const entries = useMemo(() => (load.status === "ready" ? load.entries : pass ? mergeStamps([], localStamps(pass)) : []), [load, pass]);

  return (
    <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-8 px-4 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-12">
        <div className="flex min-w-0 flex-col gap-8">
          <Cover pass={pass} wallet={wallet} qieName={passport?.qieName ?? null} count={entries.length} loading={load.status === "loading"} />

          {outbox.map((entry) => (
            <OutboxNotice key={`${entry.request.eventId}-${entry.request.doorTime}`} entry={entry} onSettled={reload} />
          ))}

          {load.status === "failed" ? (
            <ErrorState
              title={load.message}
              action={
                <Button variant="quiet" onClick={reload} leading={<RetryIcon className="size-4" />}>
                  {t.common.retry}
                </Button>
              }
            >
              {load.action}
            </ErrorState>
          ) : null}

          {load.status === "loading" ? (
            <BookletSkeleton label={t.common.loading} />
          ) : load.status === "failed" && entries.length === 0 ? null : (
            <StampBooklet entries={entries} holder={pass ?? ""} />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-8" aria-label={t.pass.rewardsTitle}>
          {load.status === "ready" && passport ? (
            <>
              <Rewards passport={passport} linked={wallet !== null} />
              {passport.pending.length > 0 ? <Pending passport={passport} entries={entries} deadlines={deadlines} /> : null}
              {passport.streaks.length > 0 ? <Streaks passport={passport} /> : null}
            </>
          ) : load.status === "loading" ? (
            <LoadingRegion label={t.common.loading} className="flex flex-col gap-3">
              <Skeleton className="h-7 w-48" />
              <SkeletonText lines={3} />
            </LoadingRegion>
          ) : null}
          <AttendeeCodeCard />
        </aside>
      </div>
    </div>
  );
}

function Cover({ pass, wallet, qieName, count, loading }: { pass: Address | null; wallet: Address | null; qieName: string | null; count: number; loading: boolean }) {
  const { t } = useLocale();
  return (
    <Sheet as="header" className="overflow-hidden">
      {pass ? (
        <Guilloche seed={pass} variant="rosette" detail={180} label={t.pass.guillocheLabel} className="pointer-events-none absolute -top-20 -right-28 size-72 opacity-45 sm:-top-16 sm:-right-12 sm:size-80 sm:opacity-60" />
      ) : null}
      <SheetSection className="relative flex flex-col gap-2 pb-6 sm:pb-8">
        <p className="text-sm font-medium tracking-[0.08em] text-ink-soft uppercase">Showmark</p>
        <h1 className="font-display text-3xl text-ink sm:text-4xl">{t.pass.title}</h1>
        <p className="max-w-[26rem] text-base text-ink-soft">{t.pass.subtitle}</p>
      </SheetSection>
      <Perforation />
      <SheetSection className="relative">
        {loading ? (
          <SkeletonText lines={2} />
        ) : pass ? (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-[1fr_1fr_auto]">
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <dt className="text-sm text-ink-soft">{t.pass.passLabel}</dt>
              <dd className="max-w-full">
                <AddressChip address={pass} />
              </dd>
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <dt className="text-sm text-ink-soft">{t.pass.walletLabel}</dt>
              <dd className="max-w-full">
                {wallet ? (
                  <AddressChip address={wallet} name={qieName} />
                ) : (
                  <Button href="/pass/link" variant="quiet" leading={<WalletIcon className="size-4" />}>
                    {t.checkIn.linkNow}
                  </Button>
                )}
              </dd>
            </div>
            {count > 0 ? (
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <dt className="text-sm text-ink-soft">{t.pass.stampsTitle}</dt>
                <dd className="font-display text-3xl leading-none text-ink">{count}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="text-base text-ink-soft">{t.pass.noPassNote}</p>
        )}
      </SheetSection>
    </Sheet>
  );
}

function BookletSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <Skeleton className="h-7 w-32" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-doc bg-rule-soft sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-3 bg-sheet px-3 pt-6 pb-4">
            <SkeletonStamp className="w-28" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

function Rewards({ passport, linked }: { passport: PassportData; linked: boolean }) {
  const { t } = useLocale();
  const owed = passport.claimable.filter((c) => BigInt(c.amount) > BigInt(0));
  return (
    <section aria-labelledby="rewards-title" className="flex flex-col gap-3">
      <h2 id="rewards-title" className="font-display text-xl text-ink">
        {t.pass.rewardsTitle}
      </h2>
      {owed.length === 0 ? (
        <p className="text-base text-ink-soft">{t.pass.noRewards}</p>
      ) : (
        <>
          <Ledger label={t.pass.rewardsTitle}>
            {owed.map((c) => (
              <LedgerRow key={c.token} label={c.symbol} value={<Amount value={c.amount} symbol={c.symbol} />} />
            ))}
          </Ledger>
          {linked ? (
            <Button href="/pass/withdraw" variant="primary" size="lg" block>
              {t.pass.withdrawCta}
            </Button>
          ) : (
            <Button href="/pass/link" variant="primary" size="lg" block leading={<WalletIcon className="size-5" />}>
              {t.pass.linkToWithdraw}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function Pending({ passport, entries, deadlines }: { passport: PassportData; entries: BookletEntry[]; deadlines: Record<string, string> }) {
  const { t } = useLocale();
  return (
    <section aria-labelledby="pending-title" className="flex flex-col gap-3">
      <h2 id="pending-title" className="font-display text-xl text-ink">
        {t.pass.pendingTitle}
      </h2>
      <ul className="flex flex-col divide-y divide-rule-soft border-y border-rule-soft">
        {passport.pending.map((p) => {
          const eventName = entries.find((e) => e.stamp.eventId === p.eventId)?.stamp.eventName ?? t.common.eventFallback(p.eventId);
          const deadline = deadlines[p.campaignId];
          const reason =
            p.reason === "NeedsQieId"
              ? t.pass.pendingNeedsQieId(deadline ? formatDate(deadline) : null)
              : p.reason === "PriceStale"
                ? t.pass.pendingPriceStale
                : t.pass.pendingPending;
          return (
            <li key={`${p.campaignId}-${p.eventId}`} className="flex flex-col gap-1 py-3">
              <span className="text-base font-medium text-ink">{t.pass.pendingFor(eventName)}</span>
              <span className="text-sm text-ink-soft">{reason}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Streaks({ passport }: { passport: PassportData }) {
  const { t } = useLocale();
  return (
    <section aria-labelledby="streaks-title" className="flex flex-col gap-3">
      <h2 id="streaks-title" className="font-display text-xl text-ink">
        {t.pass.streaksTitle}
      </h2>
      <Ledger label={t.pass.streaksTitle}>
        {passport.streaks.map((s) => (
          <LedgerRow key={s.seriesId} label={s.seriesName} value={<span className="font-sans">{t.pass.streakLine(s.current, s.best)}</span>} />
        ))}
      </Ledger>
    </section>
  );
}
