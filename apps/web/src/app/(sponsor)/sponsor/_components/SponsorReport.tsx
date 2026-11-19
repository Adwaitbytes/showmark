"use client";

import { addresses } from "@/lib/chain/addresses";
import { activeChain, explorerAddress } from "@/lib/chain/chains";
import { findSoftSignals } from "@/lib/sponsor/anomalies";
import { reportSchema, sponsorApi } from "@/lib/sponsor/api";
import { useApi } from "@/lib/sponsor/use-api";
import { useOnChainCampaign } from "@/lib/sponsor/use-chain";
import { Button } from "@/ui/Button";
import { ErrorState } from "@/ui/ErrorState";
import { formatCount, formatDate, formatEventWindow, formatTime, shortAddress } from "@/ui/format";
import { ArrowRightIcon, RetryIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";
import { Wordmark } from "@/ui/Wordmark";
import { amountText, statusMark } from "./campaign";
import { CampaignFacts } from "./CampaignFacts";
import { CsvLink } from "./CampaignConsole";
import { SettlementsTable } from "./SettlementsTable";

// Light ink on white paper whatever the screen theme, no grain, and A4 margins, so "Save as PDF" gives a clean
// document. Links stay clickable in the PDF, so every transaction can still be opened.
const PRINT_CSS = `
@page { size: A4; margin: 14mm 12mm 16mm; }
@media print {
  :root, :root[data-theme="dark"], :root:not([data-theme="light"]) {
    --paper: #ffffff; --paper-deep: #f1ede4; --sheet: #ffffff; --ink: #141311; --ink-soft: #4a4640; --ink-faint: #67615a;
    --stamp-blue: #2b4bd9; --vermilion: #e4442b; --vermilion-ink: #b33822; --ledger-green: #1f6b45;
    --rule: #8a8378; --rule-soft: rgb(20 19 17 / 0.16); color-scheme: light;
  }
  html, body { background: #fff !important; background-image: none !important; }
  .grain { background-image: none !important; }
  a { color: inherit; }
  tr, li, section > header { break-inside: avoid; }
  h2 { break-after: avoid; }
}
`;

function ReportSkeleton() {
  return (
    <LoadingRegion label="Preparing the report" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-12 w-96 max-w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-72 w-full" />
    </LoadingRegion>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 border-b border-ink pb-2 font-display text-xl">{children}</h2>;
}

export function SponsorReport({ id }: { id: string }) {
  const { state, reload } = useApi(sponsorApi.report(id, "json"), reportSchema);
  const chain = useOnChainCampaign(id);

  if (state.status === "loading") return <ReportSkeleton />;
  if (state.status === "error" || !state.data) {
    return (
      <ErrorState
        as="h1"
        title={state.status === "error" && state.error.httpStatus === 404 ? `There is no campaign #${id}` : (state.error?.message ?? "The report could not be prepared.")}
        action={
          <Button variant="quiet" onClick={reload} leading={<RetryIcon className="size-4" />}>
            Try again
          </Button>
        }
      >
        {state.error?.action ?? "Try again in a moment."}
      </ErrorState>
    );
  }

  const { campaign: c, generatedAt } = state.data;
  const sym = c.tokenSymbol;
  const sum = (pick: (s: (typeof c.settlements)[number]) => string) => c.settlements.reduce((n, s) => n + BigInt(pick(s)), 0n);
  const toAttendees = sum((s) => s.toAttendee);
  const toOrganizers = sum((s) => s.toOrganizer);
  const fees = sum((s) => s.fee);
  const gross = sum((s) => s.gross);
  const attendees = new Set(c.settlements.map((s) => s.attendee.toLowerCase())).size;
  const events = c.events.filter((e) => e.approved || e.settled > 0);
  const signals = findSoftSignals(c.settlements);
  const onChain = chain.status === "ready" ? chain.value : null;
  const mark = statusMark(c.status);

  return (
    <article className="flex flex-col gap-10 text-ink print:gap-7">
      <style>{PRINT_CSS}</style>

      <header className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4 border-b-2 border-ink pb-4">
          <span className="text-[1.6rem]">
            <Wordmark />
          </span>
          <span className="text-right text-sm text-ink-soft">
            Sponsor report
            <span className="block font-mono text-xs">
              {formatDate(generatedAt)}, {formatTime(generatedAt)}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-soft">
            Campaign #{c.id} on {activeChain.name} · {mark.label}
          </p>
          <h1 className="font-display text-4xl print:text-3xl">{c.name}</h1>
          <p className="text-base text-ink-soft">
            Funded by {c.sponsorName}, <span className="font-mono text-sm print:hidden">{shortAddress(c.sponsor)}</span>
            <span className="hidden font-mono text-sm break-all print:inline">{c.sponsor}</span>
          </p>
        </div>
      </header>

      <section className="grid gap-8 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <H2>Verified reach</H2>
          <Ledger label="Totals">
            <LedgerRow label="Verified people paid" value={formatCount(c.settledCount)} note={`${formatCount(attendees)} distinct passes`} />
            <LedgerRow label="Paid to attendees" value={amountText(toAttendees, sym)} />
            <LedgerRow label="Paid to organizers" value={amountText(toOrganizers, sym)} />
            <LedgerRow label="Protocol fee" value={amountText(fees, sym)} />
            <LedgerRow total label="Settled" value={amountText(gross, sym)} />
            <LedgerRow label="Deposited" value={amountText(c.funded, sym)} />
            <LedgerRow label="Left in escrow" value={amountText(onChain ? onChain.balance : BigInt(c.balance), sym)} />
          </Ledger>
        </div>
        <div>
          <H2>Terms</H2>
          <CampaignFacts c={c} chain={onChain} />
        </div>
      </section>

      <section>
        <H2>How to check this report</H2>
        <p className="max-w-prose text-sm text-ink-soft">
          Every payout below links to its transaction on the QIE explorer, where the vault&apos;s Settled event shows the attendee, the organizer
          and the amounts. The vault contract is{" "}
          <a href={explorerAddress(addresses.vault)} className="font-mono text-xs break-all text-stamp-blue underline underline-offset-4">
            {addresses.vault}
          </a>
          . Each payout needed a door signature recorded on-chain at a real event; nothing here is self-reported.
        </p>
      </section>

      <section>
        <H2>Events</H2>
        {events.length === 0 ? (
          <p className="text-sm text-ink-soft">No events approved and no payouts yet.</p>
        ) : (
          <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0 print:overflow-visible">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm print:min-w-0">
            <thead>
              <tr className="border-b border-rule text-xs text-ink-soft">
                <th scope="col" className="py-2 pr-4 font-medium">Event</th>
                <th scope="col" className="py-2 pr-4 font-medium">When and where</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Checked in</th>
                <th scope="col" className="py-2 text-right font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-rule-soft align-top">
                  <td className="py-2 pr-4">
                    {e.metadata.name}
                    <span className="block font-mono text-xs text-ink-faint">
                      #{e.id}
                      {e.approved ? "" : ", revoked"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-ink-soft">
                    {formatEventWindow(e.startsAt, e.endsAt)}
                    <span className="block">{[e.metadata.venue, e.metadata.city].filter(Boolean).join(", ")}</span>
                  </td>
                  <td className="py-2 pr-4 text-right font-mono">{formatCount(e.checkedIn)}</td>
                  <td className="py-2 text-right font-mono">{formatCount(e.settled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section>
        <H2>Soft signals</H2>
        <p className="mb-3 max-w-prose text-sm text-ink-soft">Patterns computed from the payouts. They are hints for a second look, not evidence.</p>
        {signals.length === 0 ? (
          <p className="text-sm">None found in {formatCount(c.settlements.length)} payouts.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {signals.map((s) => (
              <li key={s.kind + s.title}>
                <span className="font-medium">{s.title}.</span> <span className="text-ink-soft">{s.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <H2>Every payout ({formatCount(c.settlements.length)})</H2>
        {c.settlements.length === 0 ? <p className="text-sm text-ink-soft">No payouts yet.</p> : <SettlementsTable settlements={c.settlements} symbol={sym} plain />}
      </section>

      <footer className="border-t border-rule pt-3 text-xs text-ink-faint">
        Generated by Showmark from the QIE chain index at {formatTime(generatedAt)} on {formatDate(generatedAt)}. Chain {activeChain.id},
        explorer {activeChain.blockExplorers?.default.url}.
      </footer>
    </article>
  );
}

export function ReportToolbar({ id }: { id: string }) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
      <Button variant="quiet" href={`/sponsor/${id}`} className="self-start">
        Back to the campaign
      </Button>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => window.print()} trailing={<ArrowRightIcon className="size-4" />}>
          Print or save as PDF
        </Button>
        <CsvLink id={id} />
      </div>
    </div>
  );
}
