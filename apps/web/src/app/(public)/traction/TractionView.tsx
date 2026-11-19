import type { Traction } from "@/lib/api/types";
import { addresses, isDeployed } from "@/lib/chain/addresses";
import { activeChain, explorerAddress } from "@/lib/chain/chains";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { formatCount, formatPercent, formatTime, formatTokenAmount, formatUsd } from "@/ui/format";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { DailyChart } from "./DailyChart";

/** What each number means and where it comes from. Shown on the page so a judge can audit it. */
export const DEFINITIONS = [
  ["Verified attendees", "Distinct passes with at least one CheckedIn event on the registry."],
  ["Events with check-ins", "Events that recorded at least one presence. Events nobody attended are not counted."],
  ["Team-funded and external", "A campaign is team-funded when its sponsor address belongs to the Showmark team. Everything else is external."],
  ["Settled", "Sum of Settled events from the vault, per token. Dollar values use the QIE/USD oracle price at the time this page was read."],
  ["New wallets", "Addresses whose first transaction on QIE was a Showmark check-in or link."],
  ["Linked a QIE Wallet", "Guest passes that were linked to a QIE Wallet through WalletLinked, the step people take to cash out."],
  ["Share of chain activity", "Showmark transactions in the last day divided by the chain's daily total from the explorer's stats API."],
] as const;

function totalOf(row: Traction["settled"][number]): string {
  return (BigInt(row.teamFunded) + BigInt(row.external)).toString();
}

function ExplorerLinks() {
  if (!isDeployed()) return null;
  return (
    <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <a
        href={explorerAddress(addresses.registry)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-stamp-blue underline decoration-stamp-blue/35 underline-offset-4 hover:decoration-stamp-blue"
      >
        Check-ins on the explorer
      </a>
      <a
        href={explorerAddress(addresses.vault)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-stamp-blue underline decoration-stamp-blue/35 underline-offset-4 hover:decoration-stamp-blue"
      >
        Settlements on the explorer
      </a>
    </p>
  );
}

export function Definitions() {
  return (
    <section aria-labelledby="definitions" className="flex flex-col gap-6">
      <h2 id="definitions" className="font-display text-2xl text-ink">
        How each number is counted
      </h2>
      <dl className="grid gap-x-12 border-t border-ink md:grid-cols-2">
        {DEFINITIONS.map(([term, meaning]) => (
          <div key={term} className="flex flex-col gap-1 border-b border-rule-soft py-4">
            <dt className="font-medium text-ink">{term}</dt>
            <dd className="text-base text-ink-soft">{meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function TractionEmpty() {
  return (
    <Sheet>
      <SheetSection className="py-10 sm:py-12">
        <EmptyState
          title="Nothing to count yet"
          action={
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button href="/#judges-desk" variant="primary">
                Check in at the judges&apos; desk
              </Button>
              <Button href="/docs/organizers" variant="quiet">
                Run the first event
              </Button>
            </div>
          }
        >
          {isDeployed()
            ? `No one has checked in on ${activeChain.name} yet. This ledger starts at the first real check-in and every number below will link to the chain.`
            : `The Showmark contracts are not live on ${activeChain.name} yet. Once they are, this ledger counts every real check-in and payout straight from the chain.`}
        </EmptyState>
      </SheetSection>
    </Sheet>
  );
}

/** The whole traction ledger for one Traction snapshot. Pure, so the UI gallery can render it from fixtures. */
export function TractionView({ traction }: { traction: Traction }) {
  if (traction.verifiedAttendees === 0 && traction.settled.length === 0) return <TractionEmpty />;

  const usdTotal = traction.settledUsd.teamFunded + traction.settledUsd.external;
  const hasPrice = traction.settledUsd.price > 0;

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-10">
        <p className="text-[clamp(4rem,11vw,7.5rem)] leading-[0.9] font-medium tracking-[-0.035em] text-ink">
          {formatCount(traction.verifiedAttendees)}
        </p>
        <p className="max-w-xl pb-1 text-lg text-ink-soft">
          people have checked in at {formatCount(traction.eventsWithCheckIns)} real events run by{" "}
          {formatCount(traction.organizers)} organizers, each one recorded on {activeChain.name}.
        </p>
      </div>
      <ExplorerLinks />

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <Sheet as="section" aria-labelledby="people">
          <SheetSection>
            <h2 id="people" className="mb-3 font-display text-xl text-ink">
              People
            </h2>
            <Ledger label="People">
              <LedgerRow label="Verified attendees" value={formatCount(traction.verifiedAttendees)} />
              <LedgerRow label="Came to two or more events" value={formatCount(traction.repeatAttendees)} />
              <LedgerRow
                label="New wallets first seen through Showmark"
                value={formatCount(traction.newWalletsViaShowmark)}
              />
              <LedgerRow
                label="Linked a QIE Wallet"
                value={formatCount(traction.passesLinked)}
                note={`${formatPercent(traction.conversionRate)} of verified attendees went from guest pass to QIE Wallet`}
              />
              <LedgerRow label="Hold a QIE ID" value={formatCount(traction.attendeesWithQieId)} />
            </Ledger>
          </SheetSection>
        </Sheet>

        <Sheet as="section" aria-labelledby="money">
          <SheetSection>
            <h2 id="money" className="mb-3 font-display text-xl text-ink">
              Money settled to people
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-left">
                <caption className="sr-only">Value settled per token, split by who funded it</caption>
                <thead>
                  <tr className="border-b border-ink text-sm text-ink-soft">
                    <th scope="col" className="py-2.5 font-medium">
                      Token
                    </th>
                    <th scope="col" className="py-2.5 text-right font-medium">
                      Team-funded
                    </th>
                    <th scope="col" className="py-2.5 text-right font-medium">
                      External
                    </th>
                    <th scope="col" className="py-2.5 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono text-base">
                  {traction.settled.map((row) => (
                    <tr key={row.token} className="border-b border-rule-soft">
                      <th scope="row" className="py-3 font-sans font-medium">
                        {row.symbol}
                      </th>
                      <td className="py-3 text-right">{formatTokenAmount(row.teamFunded, row.symbol)}</td>
                      <td className="py-3 text-right">{formatTokenAmount(row.external, row.symbol)}</td>
                      <td className="py-3 text-right">{formatTokenAmount(totalOf(row), row.symbol)}</td>
                    </tr>
                  ))}
                  {hasPrice ? (
                    <tr>
                      <th scope="row" className="py-3 font-sans font-medium">
                        In USD
                      </th>
                      <td className="py-3 text-right">{formatUsd(traction.settledUsd.teamFunded)}</td>
                      <td className="py-3 text-right">{formatUsd(traction.settledUsd.external)}</td>
                      <td className="py-3 text-right">{formatUsd(usdTotal)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <Ledger label="Sponsors" className="mt-4">
              <LedgerRow label="Team-funded sponsors" value={formatCount(traction.sponsors.teamFunded)} />
              <LedgerRow label="External sponsors" value={formatCount(traction.sponsors.external)} />
            </Ledger>
            {hasPrice ? (
              <p className="mt-3 text-sm text-ink-faint">
                USD at the QIE/USD oracle price of {traction.settledUsd.price} from{" "}
                {formatTime(traction.settledUsd.priceUpdatedAt)}.
              </p>
            ) : null}
          </SheetSection>
        </Sheet>
      </div>

      <Sheet as="section" aria-labelledby="activity">
        <SheetSection className="flex flex-col gap-8">
          <h2 id="activity" className="font-display text-xl text-ink">
            Activity on chain
          </h2>
          {traction.daily.length ? (
            <DailyChart daily={traction.daily} />
          ) : (
            <p className="text-base text-ink-soft">The daily chart appears after the first full day of check-ins.</p>
          )}
          <Ledger label="Activity" className="max-w-2xl">
            <LedgerRow label="Showmark transactions" value={formatCount(traction.showmarkTransactions)} />
            <LedgerRow
              label="QIE transactions in the last day"
              value={traction.chainDailyTransactions === null ? "Not available" : formatCount(traction.chainDailyTransactions)}
            />
            <LedgerRow
              label="Showmark's share of that day"
              value={traction.shareOfChainDaily === null ? "Not available" : formatPercent(traction.shareOfChainDaily, 1)}
              note={
                traction.shareOfChainDaily === null
                  ? "The explorer's stats API did not answer this time. It is asked again on the next read."
                  : undefined
              }
            />
          </Ledger>
        </SheetSection>
      </Sheet>
    </div>
  );
}
