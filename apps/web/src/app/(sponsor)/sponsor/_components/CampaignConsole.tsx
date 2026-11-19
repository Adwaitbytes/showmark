"use client";

import { useState } from "react";
import { isAddressEqual, type Address } from "viem";
import { campaignDetailSchema, sponsorApi, type SponsorCampaignDetail } from "@/lib/sponsor/api";
import { findSoftSignals } from "@/lib/sponsor/anomalies";
import { presencesCovered, usdToNativeWei } from "@/lib/sponsor/math";
import { useApi } from "@/lib/sponsor/use-api";
import { useSponsorIdentity } from "@/lib/sponsor/use-sponsor";
import { useNow, useOnChainCampaign, useOraclePrice, type OnChainCampaign } from "@/lib/sponsor/use-chain";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { formatCount, formatTime, formatTokenAmount } from "@/ui/format";
import { RetryIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";
import { StatusMark } from "@/ui/StatusMark";
import { countOf, statusMark } from "./campaign";
import { CampaignFacts } from "./CampaignFacts";
import { EventsPanel } from "./EventsPanel";
import { ManageCampaign } from "./ManageCampaign";
import { SettlementsTable } from "./SettlementsTable";
import type { SponsorSeat } from "./SponsorGate";

export function CampaignSkeleton() {
  return (
    <LoadingRegion label="Loading the campaign" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid grid-cols-2 gap-px lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </LoadingRegion>
  );
}

function Section({ id, title, intro, children, aside }: { id: string; title: string; intro?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="font-display text-2xl">
            {title}
          </h2>
          {intro ? <p className="max-w-prose text-sm text-ink-soft">{intro}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Reach({ d, chain }: { d: SponsorCampaignDetail; chain: OnChainCampaign | null }) {
  const oracle = useOraclePrice();
  const balance = chain ? chain.balance : BigInt(d.balance);
  let more: string;
  if (d.pricing === 0) {
    more = formatCount(Number(presencesCovered(balance, BigInt(d.amountPerPresence))));
  } else if (oracle.status === "ready") {
    const wei = usdToNativeWei(BigInt(d.amountPerPresence), oracle.value.answer, oracle.value.decimals);
    more = wei ? `About ${formatCount(Number(presencesCovered(balance, wei)))}` : "Unknown";
  } else {
    more = "Reading price";
  }
  const cells = [
    { label: "Verified people paid", value: formatCount(d.settledCount), unit: "", note: "One explorer transaction each" },
    { label: "Settled", value: formatTokenAmount(d.settledAmount, d.tokenSymbol), unit: d.tokenSymbol, note: "Including the protocol fee" },
    { label: "Left in escrow", value: formatTokenAmount(balance.toString(), d.tokenSymbol), unit: d.tokenSymbol, note: chain ? "Read from the vault just now" : "From the index" },
    { label: "Pays for", value: more, unit: more === "1" ? "more person" : "more people", note: d.pricing === 1 ? "At today's QIE price" : "At the current amount per person" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-doc bg-rule-soft lg:grid-cols-[1.4fr_1fr_1fr_1fr] [&>*]:bg-sheet">
      {cells.map((c, i) => (
        <div key={c.label} className={i === 0 || i === cells.length - 1 ? "col-span-2 flex flex-col gap-1 px-5 py-5 lg:col-span-1" : "flex flex-col gap-1 px-5 py-5"}>
          <dt className="text-sm text-ink-soft">{c.label}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-2 leading-none text-ink">
            <span className={i === 0 ? "font-mono text-5xl tracking-[-0.02em] text-vermilion-ink" : "font-mono text-xl sm:text-2xl"}>{c.value}</span>
            {c.unit ? <span className="text-sm text-ink-soft">{c.unit}</span> : null}
          </dd>
          <dd className="mt-1 text-sm text-ink-faint">{c.note}</dd>
        </div>
      ))}
    </dl>
  );
}

const PAGE = 15;

/** Payouts in pages, so a long campaign does not push everything else off the screen. */
function PagedSettlements({ d }: { d: SponsorCampaignDetail }) {
  const [shown, setShown] = useState(PAGE);
  const rows = d.settlements.slice(0, shown);
  const left = d.settlements.length - rows.length;
  return (
    <div className="flex flex-col gap-4">
      <SettlementsTable settlements={rows} symbol={d.tokenSymbol} />
      {left > 0 ? (
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="quiet" onClick={() => setShown((n) => n + PAGE * 2)}>
            Show {Math.min(left, PAGE * 2)} more
          </Button>
          <span className="text-sm text-ink-soft">The CSV and the printable report list every one.</span>
        </div>
      ) : null}
    </div>
  );
}

function SoftSignals({ d }: { d: SponsorCampaignDetail }) {
  const signals = findSoftSignals(d.settlements);
  return (
    <Section
      id="signals"
      title="Soft signals"
      intro="Patterns worth a second look. These are hints computed from the payouts, not proof of anything; the door signature on every check-in is the proof."
    >
      {signals.length === 0 ? (
        <p className="text-base text-ink-soft">
          {d.settlements.length === 0 ? "Nothing to look at until the first payout." : `Nothing unusual in the latest ${countOf(d.settlements.length, "payout", "payouts")}.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {signals.map((s) => (
            <li key={s.kind + s.title}>
              <Notice tone="warning" title={s.title}>
                {s.detail}
              </Notice>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Detail({ id }: { id: string }) {
  const { state, reload } = useApi(sponsorApi.campaign(id), campaignDetailSchema, { pollMs: 15_000 });
  const chain = useOnChainCampaign(id);
  const now = useNow(30_000);
  const { seat, signedIn } = useSponsorSeatFor(state.data?.sponsor ?? null);
  const refresh = () => {
    reload();
    chain.reload();
  };

  if (state.status === "loading") return <CampaignSkeleton />;
  if (state.status === "error" && !state.data) {
    return (
      <ErrorState
        as="h1"
        title={state.error.httpStatus === 404 ? `There is no campaign #${id}` : state.error.message}
        action={
          state.error.httpStatus === 404 ? (
            <Button variant="quiet" href="/sponsor">
              Back to your campaigns
            </Button>
          ) : (
            <Button variant="quiet" onClick={reload} leading={<RetryIcon className="size-4" />}>
              Try again
            </Button>
          )
        }
      >
        {state.error.httpStatus === 404 ? "Check the number in the link. New campaigns can take a few seconds to appear." : state.error.action}
      </ErrorState>
    );
  }

  const d = state.data;
  if (!d) return null;
  const onChain = chain.status === "ready" ? chain.value : null;
  const mark = statusMark(d.status);
  const total = d.settledCount;

  return (
    <div className="flex flex-col gap-14">
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
            <span className="font-medium whitespace-nowrap text-ink-soft">Campaign #{d.id}</span>
            <StatusMark tone={mark.tone}>{mark.label}</StatusMark>
            {state.status === "ready" && state.refreshing ? <span className="text-xs text-ink-faint">Updating</span> : null}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl">{d.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-base text-ink-soft">
            Funded by {d.sponsorName} <AddressChip address={d.sponsor} />
          </p>
          {d.description ? <p className="max-w-prose text-base text-ink-soft">{d.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <CsvLink id={d.id} />
          <Button variant="quiet" href={`/sponsor/${d.id}/report`}>
            Printable report
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <Reach d={d} chain={onChain} />
        <p className="flex items-center gap-2 text-sm text-ink-faint" aria-live="off">
          <span aria-hidden="true" className="size-1.5 rounded-pill bg-ledger-green" />
          Live. Refreshes every 15 seconds{state.status === "error" ? "; the last refresh failed, so these may be a little behind" : ""}. Read at{" "}
          {formatTime(new Date(now * 1000).toISOString())}.
        </p>
      </div>

      <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-14">
          <Section id="events" title="Events" intro="Check-ins at these events are paid from this campaign.">
            <EventsPanel detail={d} seat={seat} onChanged={refresh} />
          </Section>

          <SoftSignals d={d} />

        </div>

        <aside className="flex flex-col gap-10 lg:sticky lg:top-24 lg:self-start" aria-label="Terms and controls">
          <Sheet>
            <SheetSection>
              <h2 className="mb-2 font-display text-xl">Terms</h2>
              <CampaignFacts c={d} chain={onChain} />
            </SheetSection>
          </Sheet>
          {seat && onChain ? (
            <Sheet>
              <SheetSection>
                <h2 className="mb-5 font-display text-xl">Manage</h2>
                <ManageCampaign id={d.id} symbol={d.tokenSymbol} chain={onChain} now={now} seat={seat} onChanged={refresh} />
              </SheetSection>
            </Sheet>
          ) : (
            <Notice tone="info" title={signedIn ? "You are viewing as a visitor" : "Are you the sponsor?"}>
              {signedIn
                ? "Only the wallet or Safe that created this campaign can approve events, top up, close or refund it."
                : "Sign in from the sponsor console with the wallet that created this campaign to approve events, top up or refund."}
              {!signedIn ? (
                <span className="mt-2 block">
                  <Button variant="quiet" href="/sponsor">
                    Sign in
                  </Button>
                </span>
              ) : null}
            </Notice>
          )}
        </aside>
      </div>

      <Section
        id="payouts"
        title="Payouts"
        intro={total > d.settlements.length ? `Latest ${formatCount(d.settlements.length)} of ${formatCount(total)}. The CSV and the printable report list every one.` : "Every verified person this campaign paid, newest first."}
      >
        {d.settlements.length === 0 ? (
          <EmptyState as="h3" title="No payouts yet">
            The first one appears here a few seconds after someone checks in at an approved event, with its transaction.
          </EmptyState>
        ) : (
          <PagedSettlements d={d} />
        )}
      </Section>
    </div>
  );
}

/** The signed-in seat, only when it is this campaign's sponsor. Everyone else gets the public view. */
function useSponsorSeatFor(sponsor: Address | null): { seat: SponsorSeat | null; signedIn: boolean } {
  const who = useSponsorIdentity();
  if (who.status === "safe" && !who.wrongChain) {
    const seat: SponsorSeat = { account: who.account, name: null, signer: who.signer, safe: who.ctx };
    return { seat: sponsor && isAddressEqual(who.account, sponsor) ? seat : null, signedIn: true };
  }
  if (who.status === "signed-in") {
    const seat: SponsorSeat = { account: who.account, name: who.session.qieName, signer: who.signer, safe: null };
    return { seat: sponsor && isAddressEqual(who.account, sponsor) ? seat : null, signedIn: true };
  }
  return { seat: null, signedIn: false };
}

/** A plain anchor, not a client-side Link, so the browser downloads the file instead of navigating. */
export function CsvLink({ id }: { id: string }) {
  return (
    <a
      href={sponsorApi.report(id, "csv")}
      download={`showmark-campaign-${id}.csv`}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-doc px-5 text-base font-medium text-ink shadow-[inset_0_0_0_1px_var(--rule-soft)] transition-colors duration-150 hover:bg-paper-deep hover:shadow-[inset_0_0_0_1px_var(--rule)]"
    >
      <DownloadIcon className="size-4" />
      Download CSV
    </a>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M10 3.75v9M6 9.25l4 4 4-4M4 16.25h12" />
    </svg>
  );
}

export function CampaignConsole({ id }: { id: string }) {
  return <Detail id={id} />;
}
