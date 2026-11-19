"use client";

import Link from "next/link";
import type { Address } from "viem";
import type { CampaignSummary } from "@/lib/api/types";
import { campaignSummarySchema, listOf, sponsorApi } from "@/lib/sponsor/api";
import { presencesCovered } from "@/lib/sponsor/math";
import { useApi } from "@/lib/sponsor/use-api";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { formatCount, formatDate, formatShortDate } from "@/ui/format";
import { ArrowRightIcon, RetryIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { Notice } from "@/ui/Notice";
import { Sheet } from "@/ui/Sheet";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";
import { StatusMark } from "@/ui/StatusMark";
import { amountText, perPresenceText, statusMark } from "./campaign";
import { SponsorGate, type SponsorSeat } from "./SponsorGate";

const campaignsSchema = listOf(campaignSummarySchema, "campaigns");

function Intro() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
      <div className="flex flex-col gap-5">
        <p className="text-sm font-medium text-vermilion-ink">Sponsor console</p>
        <h1 className="font-display text-3xl sm:text-4xl">Pay for the people who showed up, and nothing else</h1>
        <p className="max-w-prose text-md text-ink-soft">
          Lock a budget in escrow on QIE. Each verified check-in at an event you fund pays the attendee and the
          organizer from it, and whatever is not earned comes back to you.
        </p>
      </div>
      <Ledger label="What the contract guarantees" className="self-end">
        <LedgerRow label="Every payout" value="On the explorer" note="Headcount you can audit, one transaction per person" />
        <LedgerRow label="Protocol fee" value="5% cap" note="Hard coded in the vault and fixed when you create the campaign" />
        <LedgerRow label="Unspent budget" value="Yours" note="Refund opens 3 days after the campaign ends, even if Showmark is paused" />
      </Ledger>
    </div>
  );
}

function ListSkeleton() {
  return (
    <LoadingRegion label="Loading your campaigns" className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-doc bg-paper-deep/60 px-5 py-5 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3.5 w-40" />
          </div>
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-28" />
        </div>
      ))}
    </LoadingRegion>
  );
}

function Figure({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="font-mono text-base text-ink">{children}</dd>
    </div>
  );
}

function CampaignRow({ c }: { c: CampaignSummary }) {
  const mark = statusMark(c.status);
  const remaining = c.pricing === 0 ? presencesCovered(BigInt(c.balance), BigInt(c.amountPerPresence)) : null;
  return (
    <li>
      <Sheet className="group transition-shadow duration-200 hover:shadow-lift focus-within:shadow-lift">
        <Link
          href={`/sponsor/${c.id}`}
          className="grid gap-x-8 gap-y-4 px-5 py-5 focus-visible:outline-offset-[-2px] sm:px-6 md:grid-cols-[minmax(0,1.6fr)_auto_repeat(3,minmax(0,1fr))_auto] md:items-center"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-display text-lg leading-tight text-ink">{c.name}</span>
            <span className="text-sm text-ink-soft">
              #{c.id} · {perPresenceText(c)} · {formatShortDate(c.startsAt)} to {formatDate(c.endsAt)}
            </span>
          </div>
          <StatusMark tone={mark.tone} className="w-fit">
            {mark.label}
          </StatusMark>
          <dl className="contents">
            <Figure label="People paid">{formatCount(c.settledCount)}</Figure>
            <Figure label="Settled">{amountText(c.settledAmount, c.tokenSymbol)}</Figure>
            <Figure label="Left in escrow">
              {amountText(c.balance, c.tokenSymbol)}
              {remaining !== null ? <span className="block font-sans text-xs text-ink-faint">pays {formatCount(Number(remaining))} more</span> : null}
            </Figure>
          </dl>
          <ArrowRightIcon className="hidden size-5 text-ink-soft transition-transform duration-200 group-hover:translate-x-0.5 md:block" />
        </Link>
      </Sheet>
    </li>
  );
}

function Totals({ campaigns }: { campaigns: CampaignSummary[] }) {
  const people = campaigns.reduce((n, c) => n + c.settledCount, 0);
  const live = campaigns.filter((c) => c.status === "live").length;
  const escrow = (symbol: "QIE" | "QUSDC") =>
    campaigns.filter((c) => c.tokenSymbol === symbol).reduce((sum, c) => sum + BigInt(c.balance), 0n);
  const qie = escrow("QIE");
  const qusdc = escrow("QUSDC");
  const escrowText = [qie > 0n ? amountText(qie, "QIE") : null, qusdc > 0n ? amountText(qusdc, "QUSDC") : null].filter(Boolean).join(" and ") || "0";
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-doc bg-rule-soft sm:grid-cols-3 [&>*]:bg-sheet">
      <div className="flex flex-col gap-1 px-5 py-4">
        <dt className="text-sm text-ink-soft">Verified people paid</dt>
        <dd className="font-mono text-2xl text-ink">{formatCount(people)}</dd>
      </div>
      <div className="flex flex-col gap-1 px-5 py-4">
        <dt className="text-sm text-ink-soft">Live campaigns</dt>
        <dd className="font-mono text-2xl text-ink">{formatCount(live)}</dd>
      </div>
      <div className="col-span-2 flex flex-col gap-1 px-5 py-4 sm:col-span-1">
        <dt className="text-sm text-ink-soft">Still in escrow</dt>
        <dd className="font-mono text-lg text-ink">{escrowText}</dd>
      </div>
    </dl>
  );
}

function Campaigns({ seat }: { seat: SponsorSeat }) {
  const { state, reload } = useApi(sponsorApi.campaigns(seat.account as Address), campaignsSchema, { pollMs: 30_000 });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-vermilion-ink">Sponsor console</p>
          <h1 className="font-display text-3xl sm:text-4xl">Your campaigns</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            {seat.safe ? "Funding from Safe" : "Signed in as"} <AddressChip address={seat.account} name={seat.name} />
          </p>
        </div>
        <Button variant="primary" href="/sponsor/new" trailing={<ArrowRightIcon className="size-4" />}>
          New campaign
        </Button>
      </div>

      {seat.safe ? (
        <Notice tone="info" title="Running inside your Safe">
          Every action here is proposed to the Safe as one transaction, and runs once {seat.safe.threshold} of{" "}
          {seat.safe.owners.length} owners confirm it.
        </Notice>
      ) : null}

      {state.status === "loading" ? <ListSkeleton /> : null}

      {state.status === "error" && !state.data ? (
        <ErrorState
          title={state.error.message}
          action={
            <Button variant="quiet" onClick={reload} leading={<RetryIcon className="size-4" />}>
              Try again
            </Button>
          }
        >
          {state.error.action}
        </ErrorState>
      ) : null}

      {state.data && state.data.length === 0 ? (
        <Sheet className="px-5 py-8 sm:px-8">
          <EmptyState
            title="No campaigns yet"
            action={
              <Button variant="primary" href="/sponsor/new">
                Create your first campaign
              </Button>
            }
          >
            A campaign holds your budget in escrow and pays a fixed amount for each verified person at the events you
            choose. Setting one up takes about three minutes and two wallet confirmations.
          </EmptyState>
        </Sheet>
      ) : null}

      {state.data && state.data.length > 0 ? (
        <>
          <Totals campaigns={state.data} />
          {state.status === "error" ? (
            <Notice tone="warning" title="These numbers may be out of date">
              {state.error.message} {state.error.action}
            </Notice>
          ) : null}
          <ol className="flex flex-col gap-3" aria-label="Campaigns, newest first">
            {state.data.map((c) => (
              <CampaignRow key={c.id} c={c} />
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}

export function SponsorHome() {
  return <SponsorGate intro={<Intro />}>{(seat) => <Campaigns seat={seat} />}</SponsorGate>;
}
