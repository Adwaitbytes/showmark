"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { isAddressEqual, type Address } from "viem";
import type { EventDetail } from "@/lib/api/types";
import { isDeployed } from "@/lib/chain/addresses";
import { explorerTx } from "@/lib/chain/chains";
import { useWallet } from "@/lib/wallet/use-wallet";
import { AddressChip } from "@/ui/AddressChip";
import { Amount } from "@/ui/Amount";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { TextareaField, TextField } from "@/ui/Field";
import { formatCount, formatEventWindow, formatShortDate, formatTime } from "@/ui/format";
import { ArrowRightIcon, RetryIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { Notice } from "@/ui/Notice";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";
import { StatusMark } from "@/ui/StatusMark";
import { TxLink } from "@/ui/TxLink";
import { api, ApiRequestError, errorCopy } from "../_lib/api";
import { readEventLedger, type EventLedger, type PresenceRecord } from "../_lib/chain";
import { attendeesCsv, type AttendeeRow } from "../_lib/csv";
import { byteLength, encodeMetadata, eventMetadataSchema, MAX_METADATA_BYTES } from "../_lib/event-form";
import { usePoll } from "../_lib/use-poll";
import { eventStatus } from "./event-status";
import { NotDeployedState, SignInGate } from "./SignIn";
import { GasLine, TxProgress } from "./TxFeedback";
import { useGasQuote, useRegistryTx } from "./use-registry-tx";

const DETAIL_POLL_MS = 5_000;
const LEDGER_POLL_MS = 30_000;
const LIST_PAGE = 50;

interface AttendeeView {
  attendee: Address;
  name: string | null;
  mode: 1 | 2;
  at: string;
  tx: `0x${string}`;
  streak: number;
}

/** The chain ledger has every check-in; the API adds names and catches check-ins newer than the last ledger read. */
function mergeAttendees(ledger: EventLedger | null, detail: EventDetail): AttendeeView[] {
  const names = new Map(detail.recentCheckIns.map((c) => [c.attendee.toLowerCase(), c.name]));
  const byAttendee = new Map<string, AttendeeView>();
  const fromLedger = (p: PresenceRecord): AttendeeView => ({
    attendee: p.attendee,
    name: names.get(p.attendee.toLowerCase()) ?? null,
    mode: p.mode,
    at: new Date(Number(p.doorTime) * 1000).toISOString(),
    tx: p.tx,
    streak: p.streak,
  });
  for (const p of ledger?.presences ?? []) byAttendee.set(p.attendee.toLowerCase(), fromLedger(p));
  for (const c of detail.recentCheckIns) {
    if (!byAttendee.has(c.attendee.toLowerCase())) byAttendee.set(c.attendee.toLowerCase(), { ...c, streak: 0 });
  }
  return [...byAttendee.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Attendees({ detail, ledger, ledgerLoading, ledgerFailed, onRetryLedger }: {
  detail: EventDetail;
  ledger: EventLedger | null;
  ledgerLoading: boolean;
  ledgerFailed: boolean;
  onRetryLedger(): void;
}) {
  const [showAll, setShowAll] = useState(false);
  const attendees = useMemo(() => mergeAttendees(ledger, detail), [ledger, detail]);
  const shown = showAll ? attendees : attendees.slice(0, LIST_PAGE);
  const complete = ledger !== null;

  function exportCsv() {
    const rows: AttendeeRow[] = attendees.map((a) => ({ attendee: a.attendee, qieName: a.name, mode: a.mode, doorTime: a.at, streak: a.streak, tx: a.tx }));
    downloadCsv(`showmark-event-${detail.id}-attendees.csv`, attendeesCsv(rows, explorerTx));
  }

  return (
    <Sheet as="section" aria-labelledby="attendees-title">
      <SheetSection className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="attendees-title" className="font-display text-2xl">
              Attendees
            </h2>
            <p className="text-sm text-ink-soft">
              {complete
                ? `Every check-in recorded on QIE for this event. Updates every few seconds.`
                : ledgerLoading
                  ? "Showing the latest check-ins while the full list is read from the chain."
                  : "Showing the latest check-ins only."}
            </p>
          </div>
          <Button onClick={exportCsv} disabled={!complete || attendees.length === 0}>
            {complete ? "Export CSV" : "Export CSV (loading)"}
          </Button>
        </div>
        {ledgerFailed && !complete ? (
          <Notice tone="warning" title="The full list could not be read from the chain">
            The latest {detail.recentCheckIns.length} check-ins are shown.{" "}
            <button type="button" onClick={onRetryLedger} className="underline underline-offset-4">
              Try again
            </button>
          </Notice>
        ) : null}
        {attendees.length === 0 ? (
          <EmptyState as="h3" title="No check-ins yet">
            People appear here a few seconds after they check in at the door. Open the door screen and ask a helper who is really attending to check in first.
          </EmptyState>
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto sm:-mx-8">
              <table className="w-full min-w-[36rem] border-collapse text-left text-base" data-testid="attendee-table">
                <caption className="sr-only">Attendees, newest first</caption>
                <thead>
                  <tr className="border-b border-rule-soft text-sm text-ink-soft">
                    <th scope="col" className="py-2 pr-4 pl-5 font-medium sm:pl-8">Attendee</th>
                    <th scope="col" className="px-4 py-2 font-medium">Door time</th>
                    <th scope="col" className="px-4 py-2 font-medium">Proof</th>
                    <th scope="col" className="py-2 pr-5 pl-4 text-right font-medium sm:pr-8">Record</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.attendee} className="border-b border-rule-soft last:border-0">
                      <td className="py-2.5 pr-4 pl-5 sm:pl-8">
                        <AddressChip address={a.attendee} name={a.name} link="passport" copy={false} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-ink-soft">
                        {formatShortDate(a.at)}, {formatTime(a.at)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-ink-soft">{a.mode === 2 ? "Door scanned" : "Door code"}</td>
                      <td className="py-2.5 pr-5 pl-4 text-right sm:pr-8">
                        <TxLink hash={a.tx} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {attendees.length > LIST_PAGE ? (
              <Button onClick={() => setShowAll((v) => !v)}>{showAll ? "Show the latest 50" : `Show all ${formatCount(attendees.length)}`}</Button>
            ) : null}
          </>
        )}
      </SheetSection>
    </Sheet>
  );
}

function Payouts({ detail, ledger, ledgerLoading }: { detail: EventDetail; ledger: EventLedger | null; ledgerLoading: boolean }) {
  const campaignIds = useMemo(() => [...new Set((ledger?.payouts ?? []).map((p) => p.campaignId.toString()))], [ledger]);
  const known = useMemo(() => new Map(detail.campaigns.map((c) => [c.id, { symbol: c.tokenSymbol, name: c.name }])), [detail.campaigns]);
  const tokens = usePoll(
    campaignIds.length ? `tokens:${campaignIds.join(",")}` : null,
    async () => {
      const out = new Map(known);
      await Promise.all(
        campaignIds
          .filter((id) => !out.has(id))
          .map(async (id) => {
            const c = await api.campaignToken(id);
            out.set(id, { symbol: c.tokenSymbol, name: c.name });
          }),
      );
      return out;
    },
    0,
  );

  const totals = useMemo(() => {
    const sums = new Map<string, { symbol: "QIE" | "QUSDC"; name: string; organizer: bigint; attendees: bigint; count: number }>();
    for (const p of ledger?.payouts ?? []) {
      const id = p.campaignId.toString();
      const token = tokens.data?.get(id) ?? known.get(id);
      if (!token) continue;
      const row = sums.get(id) ?? { symbol: token.symbol, name: token.name, organizer: 0n, attendees: 0n, count: 0 };
      row.organizer += p.toOrganizer;
      row.attendees += p.toAttendee;
      row.count += 1;
      sums.set(id, row);
    }
    return [...sums.entries()];
  }, [ledger, tokens.data, known]);

  return (
    <Sheet as="section" aria-labelledby="payouts-title">
      <SheetSection className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="payouts-title" className="font-display text-2xl">
            Payouts
          </h2>
          <p className="text-sm text-ink-soft">What sponsors paid for check-ins at this event, read from the vault’s payout records on QIE.</p>
        </div>
        {detail.campaigns.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-md font-medium">Paying for this event now</h3>
            <ul className="flex flex-col gap-2">
              {detail.campaigns.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-doc bg-paper-deep px-4 py-3">
                  <span>
                    <span className="font-medium">{c.sponsorName}</span> <span className="text-ink-soft">· {c.name}</span>
                  </span>
                  <span className="text-sm text-ink-soft">
                    <Amount value={c.attendeeAmount} symbol={c.tokenSymbol} /> to each attendee
                    {c.minProofMode === 2 ? ", door scans you only" : ""}
                    {c.requireQieId ? ", QIE ID holders" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {ledgerLoading && !ledger ? (
          <LoadingRegion label="Reading payouts">
            <Skeleton className="h-20 w-full" />
          </LoadingRegion>
        ) : !ledger ? (
          <p className="text-base text-ink-soft">Payouts could not be read from the chain just now. They are safe in the vault either way.</p>
        ) : ledger.payouts.length === 0 ? (
          <EmptyState as="h3" title="No payouts yet">
            {detail.campaigns.length === 0
              ? "No sponsor campaign pays for this event yet. Send the event link to a sponsor so they can approve it in their campaign."
              : "Each check-in is paid out a few seconds after it is recorded."}
          </EmptyState>
        ) : (
          <>
            <Ledger label="Payouts by campaign">
              {totals.map(([id, t]) => (
                <LedgerRow
                  key={id}
                  label={`${t.name} (${formatCount(t.count)} paid)`}
                  value={<Amount value={t.organizer.toString()} symbol={t.symbol} />}
                  note={
                    <>
                      To you. Attendees received <Amount value={t.attendees.toString()} symbol={t.symbol} />.
                    </>
                  }
                />
              ))}
            </Ledger>
            {tokens.error ? <p className="text-sm text-ink-soft">Some campaigns could not be named, so their payouts are not totalled here yet.</p> : null}
            <p className="text-sm text-ink-soft">Your share waits in the vault until you withdraw it from the console home page.</p>
          </>
        )}
      </SheetSection>
    </Sheet>
  );
}

function Manage({ detail, account, onSaved }: { detail: EventDetail; account: Address; onSaved(): void }) {
  const wallet = useWallet();
  const walletAccount = wallet.status === "connected" ? wallet.account : null;
  const canSign = walletAccount !== null && isAddressEqual(walletAccount, account);
  const [meta, setMeta] = useState({
    name: detail.metadata.name,
    venue: detail.metadata.venue,
    city: detail.metadata.city,
    description: detail.metadata.description,
    url: detail.metadata.url ?? "",
  });
  const [capacity, setCapacity] = useState(detail.capacity === 0 ? "" : String(detail.capacity));
  const [metaError, setMetaError] = useState<Partial<Record<keyof typeof meta, string>>>({});
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const metaTx = useRegistryTx();
  const capTx = useRegistryTx();

  const parsed = eventMetadataSchema.safeParse({ v: 1, ...meta, ...(meta.url.trim() ? {} : { url: undefined }) });
  const json = parsed.success ? encodeMetadata(parsed.data) : null;
  const metaQuote = useGasQuote(canSign && json ? `meta:${detail.id}:${json}` : null, json ? { functionName: "updateEventMetadata", args: [BigInt(detail.id), json] } : null, walletAccount);

  async function saveMeta(e: FormEvent) {
    e.preventDefault();
    if (!parsed.success) {
      const errs: Partial<Record<keyof typeof meta, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && key in meta) errs[key as keyof typeof meta] ??= issue.message;
      }
      setMetaError(errs);
      return;
    }
    if (json && byteLength(json) > MAX_METADATA_BYTES) {
      setMetaError({ description: `The details come to ${byteLength(json)} bytes and the chain accepts ${MAX_METADATA_BYTES}. Shorten the description.` });
      return;
    }
    setMetaError({});
    if (!walletAccount || !json) return;
    if (await metaTx.run({ functionName: "updateEventMetadata", args: [BigInt(detail.id), json] }, walletAccount)) onSaved();
  }

  async function saveCapacity(e: FormEvent) {
    e.preventDefault();
    const value = capacity.trim() === "" ? 0 : Number(capacity);
    if (!Number.isInteger(value) || value < 0 || value > 4_294_967_295) {
      setCapacityError("Use a whole number of people, or leave it empty for no limit.");
      return;
    }
    if (value !== 0 && value < detail.checkedIn) {
      setCapacityError(`${formatCount(detail.checkedIn)} people are already checked in. Set at least that many, or leave it empty for no limit.`);
      return;
    }
    setCapacityError(null);
    if (!walletAccount) return;
    if (await capTx.run({ functionName: "setCapacity", args: [BigInt(detail.id), value] }, walletAccount)) onSaved();
  }

  const field = (key: keyof typeof meta) => (e: { target: { value: string } }) => setMeta((m) => ({ ...m, [key]: e.target.value }));

  return (
    <Sheet as="section" aria-labelledby="manage-title">
      <SheetSection className="flex flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h2 id="manage-title" className="font-display text-2xl">
            Edit the event
          </h2>
          <p className="text-sm text-ink-soft">Each change is a small transaction from your wallet. The start and end times cannot be changed.</p>
        </div>
        {!canSign ? (
          <Notice tone="warning" title="Connect the organizer’s wallet to make changes">
            QIE Wallet is not connected, or it is on a different account from the one that created this event.
          </Notice>
        ) : null}
        <form onSubmit={saveCapacity} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <TextField
              id="manage-capacity"
              label="Capacity"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="No limit"
              error={capacityError ?? undefined}
              hint={`${formatCount(detail.checkedIn)} checked in so far.`}
              fieldClassName="flex-1"
            />
            <Button type="submit" pending={capTx.busy} disabled={!canSign} className="sm:mt-7">
              Change capacity
            </Button>
          </div>
          <TxProgress phase={capTx.phase} account={walletAccount} doneTitle="Capacity changed" />
        </form>
        <form onSubmit={saveMeta} noValidate className="flex flex-col gap-4">
          <TextField id="manage-name" label="Event name" value={meta.name} onChange={field("name")} error={metaError.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="manage-venue" label="Venue" value={meta.venue} onChange={field("venue")} error={metaError.venue} />
            <TextField id="manage-city" label="City" value={meta.city} onChange={field("city")} error={metaError.city} />
          </div>
          <TextareaField id="manage-description" label="Description" optional value={meta.description} onChange={field("description")} error={metaError.description} />
          <TextField id="manage-url" label="Event link" optional type="url" value={meta.url} onChange={field("url")} error={metaError.url} placeholder="https://" />
          <div className="flex flex-col gap-3">
            <Button type="submit" variant="secondary" pending={metaTx.busy} disabled={!canSign} className="self-start">
              Save details
            </Button>
            {metaTx.phase.kind === "idle" && canSign ? <GasLine quote={metaQuote} account={walletAccount} /> : null}
            <TxProgress phase={metaTx.phase} account={walletAccount} doneTitle="Details saved. The public page updates within a minute." />
          </div>
        </form>
      </SheetSection>
    </Sheet>
  );
}

function ConsoleBody({ eventId, account }: { eventId: string; account: Address }) {
  const detail = usePoll(`detail:${eventId}`, () => api.event(eventId), DETAIL_POLL_MS);
  const createdTx = detail.data?.createdTx ?? null;
  const ledger = usePoll(createdTx ? `ledger:${eventId}:${createdTx}` : null, () => readEventLedger(BigInt(eventId), createdTx!), LEDGER_POLL_MS);
  const checkedInSeen = useRef<number | null>(null);
  const refreshLedger = ledger.refresh;

  // A new check-in on the live count means the chain ledger has something new; read it now instead of waiting.
  const live = detail.data?.checkedIn ?? null;
  useEffect(() => {
    if (live === null) return;
    if (checkedInSeen.current !== null && live > checkedInSeen.current) refreshLedger();
    checkedInSeen.current = live;
  }, [live, refreshLedger]);

  if (detail.loading) {
    return (
      <Container className="py-12">
        <LoadingRegion label="Loading the event" className="flex flex-col gap-6">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </LoadingRegion>
      </Container>
    );
  }
  if (!detail.data) {
    const notFound = detail.error instanceof ApiRequestError && detail.error.status === 404;
    return (
      <Container className="py-16">
        {notFound ? (
          <ErrorState as="h1" title={`There is no event ${eventId} on Showmark`} action={<Button href="/organize">Back to your events</Button>}>
            If you just created it, wait a few seconds for the transaction to be indexed, then reload.
          </ErrorState>
        ) : (
          <ErrorState
            as="h1"
            title="This event did not load"
            action={
              <Button onClick={detail.refresh} leading={<RetryIcon className="size-4" />}>
                Try again
              </Button>
            }
          >
            {errorCopy(detail.error).message} {errorCopy(detail.error).action}
          </ErrorState>
        )}
      </Container>
    );
  }

  const event = detail.data;
  const status = eventStatus(event.startsAt, event.endsAt);
  const isOrganizer = isAddressEqual(event.organizer, account);
  const place = [event.metadata.venue, event.metadata.city].filter(Boolean).join(", ");

  return (
    <Container className="flex flex-col gap-10 py-10 sm:py-14">
      <header className="flex flex-col gap-6">
        <Link href="/organize" className="inline-flex min-h-11 items-center self-start text-base text-ink-soft underline-offset-4 hover:text-ink hover:underline">
          Your events
        </Link>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-3xl flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusMark tone={status.tone}>{status.label}</StatusMark>
              <span className="font-mono text-sm text-ink-faint">Event #{event.id}</span>
              {event.seriesId !== "0" ? <span className="text-sm text-ink-soft">Series {event.seriesId}, event {event.seriesIndex}</span> : null}
            </div>
            <h1 className="font-display text-4xl text-balance text-ink sm:text-5xl">{event.metadata.name}</h1>
            <p className="text-md text-ink-soft">
              {formatEventWindow(event.startsAt, event.endsAt)}
              {place ? `. ${place}` : ""}
            </p>
          </div>
          {isOrganizer && status.tone !== "ended" ? (
            <div className="flex shrink-0 flex-wrap gap-3">
              <Button href={`/door/${event.id}`} variant="primary" size="lg" trailing={<ArrowRightIcon className="size-4" />}>
                Open the door screen
              </Button>
              <Button href={`/door/${event.id}/scan`} size="lg">
                Scan attendee codes
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {!isOrganizer ? (
        <Notice tone="warning" title="You are not the organizer of this event">
          You can see its check-ins, but only the wallet that created it can open a door or change it.
        </Notice>
      ) : null}
      {detail.error ? (
        <Notice tone="warning" title="Live updates paused">
          {errorCopy(detail.error).message} Showing the last numbers we loaded.
        </Notice>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex flex-col gap-10">
          <Attendees detail={event} ledger={ledger.data} ledgerLoading={ledger.loading} ledgerFailed={Boolean(ledger.error)} onRetryLedger={ledger.refresh} />
          <Payouts detail={event} ledger={ledger.data} ledgerLoading={ledger.loading} />
        </div>
        <aside className="flex flex-col gap-6">
          <Sheet edge="stub-bottom">
            <SheetSection className="flex flex-col gap-3">
              <p className="text-sm font-medium tracking-[0.12em] text-ink-soft uppercase">Checked in</p>
              <p className="font-display text-5xl leading-none text-ink" data-testid="console-count">
                {formatCount(event.checkedIn)}
              </p>
              <Ledger label="Event numbers">
                <LedgerRow label="Capacity" value={event.capacity > 0 ? formatCount(event.capacity) : "No limit"} />
                <LedgerRow label="Door code valid for" value={`${event.maxPassAge} s`} />
                <LedgerRow label="Campaigns paying" value={formatCount(event.campaigns.length)} />
              </Ledger>
              <p className="flex flex-wrap items-center gap-2 pt-1 text-sm text-ink-soft">
                Organizer <AddressChip address={event.organizer} name={event.organizerName} />
              </p>
              <TxLink hash={event.createdTx}>Creation transaction</TxLink>
            </SheetSection>
          </Sheet>
          {isOrganizer ? <Manage key={`${event.metadata.name}|${event.capacity}`} detail={event} account={account} onSaved={detail.refresh} /> : null}
        </aside>
      </div>
    </Container>
  );
}

export function EventConsole() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  if (!isDeployed()) return <NotDeployedState />;
  if (!/^[1-9]\d{0,19}$/.test(eventId ?? "")) {
    return (
      <Container className="py-16">
        <ErrorState as="h1" title="This event link is not valid" action={<Button href="/organize">Back to your events</Button>}>
          The event number in the link is missing or malformed.
        </ErrorState>
      </Container>
    );
  }
  return <SignInGate>{(session) => <ConsoleBody eventId={eventId} account={session.address} />}</SignInGate>;
}
