"use client";

import Link from "next/link";
import { useState } from "react";
import { isAddressEqual } from "viem";
import type { Address, EventSummary } from "@/lib/api/types";
import { connect, useWallet } from "@/lib/wallet/use-wallet";
import { Amount } from "@/ui/Amount";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { formatCount, formatEventWindow, formatTokenAmount } from "@/ui/format";
import { ArrowRightIcon, RetryIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { Notice } from "@/ui/Notice";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";
import { StatusMark } from "@/ui/StatusMark";
import { api, errorCopy } from "../_lib/api";
import { readClaimable, type ClaimableBalance } from "../_lib/chain";
import type { RegistryCall } from "../_lib/tx";
import { usePoll } from "../_lib/use-poll";
import { eventStatus } from "./event-status";
import { SignInGate } from "./SignIn";
import { GasLine, TxProgress } from "./TxFeedback";
import { useGasQuote, useRegistryTx } from "./use-registry-tx";

const EVENTS_POLL_MS = 15_000;

function EventRow({ event }: { event: EventSummary }) {
  const status = eventStatus(event.startsAt, event.endsAt);
  const place = [event.metadata.venue, event.metadata.city].filter(Boolean).join(", ");
  return (
    <li>
      <Sheet className="transition-shadow duration-200 hover:shadow-lift">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:gap-8 sm:px-7">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusMark tone={status.tone}>{status.label}</StatusMark>
              <span className="font-mono text-sm text-ink-faint">#{event.id}</span>
            </div>
            <h3 className="font-display text-xl leading-tight text-ink">
              <Link href={`/organize/${event.id}`} className="rounded-doc after:absolute after:inset-0 after:content-[''] hover:underline hover:decoration-1 hover:underline-offset-4">
                {event.metadata.name}
              </Link>
            </h3>
            <p className="text-base text-ink-soft">
              {formatEventWindow(event.startsAt, event.endsAt)}
              {place ? <span className="block sm:inline"> · {place}</span> : null}
            </p>
          </div>
          <div className="flex items-end justify-between gap-6 sm:flex-col sm:items-end sm:gap-1">
            <p className="text-right">
              <span className="font-display text-3xl text-ink">{formatCount(event.checkedIn)}</span>
              <span className="ml-1.5 text-base text-ink-soft">
                {event.capacity > 0 ? `of ${formatCount(event.capacity)}` : "checked in"}
              </span>
            </p>
            {status.tone !== "ended" ? (
              <Link
                href={`/door/${event.id}`}
                className="relative z-10 inline-flex min-h-11 items-center gap-1.5 rounded-doc text-base font-medium text-stamp-blue underline decoration-stamp-blue/35 underline-offset-4 hover:decoration-stamp-blue"
              >
                Door screen <ArrowRightIcon className="size-4" />
              </Link>
            ) : null}
          </div>
        </div>
      </Sheet>
    </li>
  );
}

function EventsSkeleton() {
  return (
    <LoadingRegion label="Loading your events" className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </LoadingRegion>
  );
}

function WithdrawAction({ balance, account, onDone }: { balance: ClaimableBalance; account: Address; onDone(): void }) {
  const wallet = useWallet();
  const walletAccount = wallet.status === "connected" ? wallet.account : null;
  const isAccount = walletAccount !== null && isAddressEqual(walletAccount, account);
  const call: RegistryCall = { functionName: "withdraw", args: [balance.token, account] };
  const [asked, setAsked] = useState(false);
  const quote = useGasQuote(asked && isAccount ? `withdraw:${balance.token}:${balance.amount}` : null, call, walletAccount);
  const tx = useRegistryTx();

  async function withdraw() {
    if (!walletAccount) return;
    if (await tx.run(call, walletAccount)) onDone();
  }

  if (!asked && tx.phase.kind === "idle") {
    return (
      <Button onClick={() => setAsked(true)} className="self-start">
        Withdraw {balance.symbol} to your wallet
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid={`withdraw-${balance.symbol}`}>
      {!isAccount ? (
        walletAccount === null ? (
          <Button onClick={() => void connect()} pending={wallet.status === "connecting"} className="self-start">
            Connect QIE Wallet to withdraw
          </Button>
        ) : (
          <Notice tone="warning" title="This is a different wallet">
            Switch QIE Wallet to the account you signed in with, which ends in <span className="font-mono">{account.slice(-4)}</span>. Only it can withdraw these payouts.
          </Notice>
        )
      ) : tx.phase.kind === "done" ? null : (
        <>
          <Button
            variant="secondary"
            onClick={() => void withdraw()}
            pending={tx.busy}
            disabled={quote.kind === "ready" && !quote.quote.enough}
            className="self-start"
          >
            Confirm withdrawal of {formatTokenAmount(balance.amount.toString(), balance.symbol)} {balance.symbol}
          </Button>
          {tx.phase.kind === "idle" ? <GasLine quote={quote} account={walletAccount} /> : null}
        </>
      )}
      <TxProgress phase={tx.phase} account={walletAccount} doneTitle="Withdrawn to your wallet" />
    </div>
  );
}

function Payouts({ account }: { account: Address }) {
  const claimable = usePoll(`claimable:${account}`, () => readClaimable(account), 30_000);

  return (
    <Sheet as="section" aria-labelledby="payouts-title">
      <SheetSection className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="payouts-title" className="font-display text-xl text-ink">
            Payouts waiting for you
          </h2>
          <p className="text-sm text-ink-soft">
            Your share of every sponsored check-in, held in the Showmark vault until you withdraw it. Read live from the chain. Withdrawing is a small transaction from your own wallet.
          </p>
        </div>
        {claimable.loading ? (
          <LoadingRegion label="Reading your payouts">
            <Skeleton className="h-16 w-full" />
          </LoadingRegion>
        ) : claimable.data === null ? (
          <Notice tone="warning" title="Your payouts could not be read from the chain">
            Check the connection and{" "}
            <button type="button" className="underline underline-offset-4" onClick={claimable.refresh}>
              try again
            </button>
            .
          </Notice>
        ) : (
          <>
            <Ledger label="Payouts waiting">
              {claimable.data.map((b) => (
                <LedgerRow key={b.symbol} label={b.symbol} value={<Amount value={b.amount.toString()} symbol={b.symbol} />} />
              ))}
            </Ledger>
            {claimable.data
              .filter((b) => b.amount > 0n)
              .map((b) => (
                <WithdrawAction key={b.symbol} balance={b} account={account} onDone={() => setTimeout(claimable.refresh, 3_000)} />
              ))}
          </>
        )}
      </SheetSection>
    </Sheet>
  );
}

function Console({ account, name, onSignOut }: { account: Address; name: string | null; onSignOut(): void }) {
  const events = usePoll(`events:${account}`, () => api.organizerEvents(account), EVENTS_POLL_MS);
  const list = events.data;

  return (
    <Container className="flex flex-col gap-10 py-10 sm:py-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-ink-soft">Organizer console</p>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Your events</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            Signed in as <AddressChip address={account} name={name} />
            <button type="button" onClick={onSignOut} className="inline-flex min-h-11 items-center rounded-doc px-2 text-ink-soft underline underline-offset-4 hover:text-ink">
              Sign out
            </button>
          </p>
        </div>
        <Button href="/organize/new" variant="primary" size="lg">
          Create an event
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-labelledby="events-title" className="flex flex-col gap-4">
          <h2 id="events-title" className="sr-only">
            Events
          </h2>
          {events.loading ? (
            <EventsSkeleton />
          ) : list === null ? (
            <ErrorState
              title="Your events did not load"
              action={
                <Button onClick={events.refresh} leading={<RetryIcon className="size-4" />}>
                  Try again
                </Button>
              }
            >
              {errorCopy(events.error).message} {errorCopy(events.error).action}
            </ErrorState>
          ) : list.length === 0 ? (
            <Sheet>
              <SheetSection>
                <EmptyState title="No events yet" action={<Button href="/organize/new" variant="primary">Create your first event</Button>}>
                  Create an event and it shows up here with its live check-in count. Events take a few seconds to appear after the transaction lands.
                </EmptyState>
              </SheetSection>
            </Sheet>
          ) : (
            <>
              {events.error ? (
                <Notice tone="warning" title="Showing the last list we loaded">
                  {errorCopy(events.error).message} The list refreshes by itself.
                </Notice>
              ) : null}
              <ul className="flex flex-col gap-4">
                {list.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </>
          )}
        </section>
        <aside className="flex flex-col gap-6">
          <Payouts account={account} />
          <Sheet tone="inset">
            <SheetSection className="flex flex-col gap-2">
              <h2 className="text-md font-medium text-ink">First time running a door?</h2>
              <p className="text-base text-ink-soft">The organizer playbook walks through the ten minutes before doors open, what to print and what to say to the room.</p>
              <Link href="/docs/organizers" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-stamp-blue underline decoration-stamp-blue/35 underline-offset-4">
                Read the playbook <ArrowRightIcon className="size-4" />
              </Link>
            </SheetSection>
          </Sheet>
        </aside>
      </div>
    </Container>
  );
}

export function OrganizerHome() {
  return <SignInGate>{(session, state) => <Console account={session.address} name={session.qieName} onSignOut={() => void state.signOut()} />}</SignInGate>;
}
