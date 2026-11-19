"use client";

import { useMemo, useState } from "react";
import { encodeFunctionData } from "viem";
import type { EventSummary } from "@/lib/api/types";
import { vaultAbi } from "@/lib/chain/abi";
import { addresses } from "@/lib/chain/addresses";
import { eventSummarySchema, listOf, sponsorApi, type SponsorCampaignDetail } from "@/lib/sponsor/api";
import { isBusy, runCalls, type TxPhase } from "@/lib/sponsor/tx";
import { useApi } from "@/lib/sponsor/use-api";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Input } from "@/ui/Field";
import { formatCount, formatEventWindow } from "@/ui/format";
import { RetryIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";
import type { SponsorSeat } from "./SponsorGate";
import { TxStatus } from "./TxStatus";

const eventsSchema = listOf(eventSummarySchema, "events");

type Row = EventSummary & { approved?: boolean; settled?: number };

function EventLine({ e, action, phase, via, successText }: { e: Row; action?: React.ReactNode; phase?: TxPhase; via: "wallet" | "safe"; successText: string }) {
  const place = [e.metadata.venue, e.metadata.city].filter(Boolean).join(", ");
  return (
    <li className="flex flex-col gap-3 border-b border-rule-soft py-4 last:border-b-0 sm:flex-row sm:items-start sm:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <a href={`/e/${e.id}`} className="font-medium text-ink underline decoration-transparent underline-offset-4 hover:decoration-current">
            {e.metadata.name || `Event ${e.id}`}
          </a>
          <span className="font-mono text-xs text-ink-faint">#{e.id}</span>
        </p>
        <p className="text-sm text-ink-soft">
          {formatEventWindow(e.startsAt, e.endsAt)}
          {place ? ` · ${place}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          Organizer <AddressChip address={e.organizer} name={e.organizerName} copy={false} />
        </div>
      </div>
      <dl className="flex gap-6 sm:w-48 sm:justify-end">
        <div className="flex flex-col">
          <dt className="text-xs text-ink-faint">Checked in</dt>
          <dd className="font-mono text-base">{formatCount(e.checkedIn)}</dd>
        </div>
        {e.settled !== undefined ? (
          <div className="flex flex-col">
            <dt className="text-xs text-ink-faint">Paid</dt>
            <dd className="font-mono text-base">{formatCount(e.settled)}</dd>
          </div>
        ) : null}
      </dl>
      {action ? (
        <div className="flex flex-col gap-2 sm:w-44 sm:items-end">
          {action}
          {phase ? <TxStatus phase={phase} via={via} successText={successText} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function useEventTx(seat: SponsorSeat | null, campaignId: string, onChanged: () => void) {
  const [phases, setPhases] = useState<Record<string, TxPhase>>({});
  async function send(fn: "approveEvents" | "revokeEvents", eventId: string) {
    if (!seat) return;
    const data = encodeFunctionData({ abi: vaultAbi, functionName: fn, args: [BigInt(campaignId), [BigInt(eventId)]] });
    const key = `${fn}:${eventId}`;
    const outcome = await runCalls(seat.signer, [{ to: addresses.vault, data, value: 0n }], (p) => setPhases((all) => ({ ...all, [key]: p })));
    if (outcome.ok) onChanged();
  }
  return { phases, send };
}

function AddEvents({ seat, campaignId, already, onChanged }: { seat: SponsorSeat; campaignId: string; already: Set<string>; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const { state, reload } = useApi(sponsorApi.events(), eventsSchema);
  const { phases, send } = useEventTx(seat, campaignId, onChanged);

  const results = useMemo(() => {
    if (!state.data) return [];
    const q = query.trim().toLowerCase();
    return state.data
      .filter((e) => !already.has(e.id))
      .filter(
        (e) =>
          q === "" ||
          e.id === q.replace(/^#/, "") ||
          e.metadata.name.toLowerCase().includes(q) ||
          e.metadata.city.toLowerCase().includes(q) ||
          e.metadata.venue.toLowerCase().includes(q) ||
          e.organizer.toLowerCase() === q ||
          (e.organizerName ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [state.data, query, already]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="event-search" className="text-sm font-medium text-ink">
          Find events to fund
        </label>
        <Input
          id="event-search"
          type="search"
          placeholder="Name, city, organizer, .qie name or event number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby="event-search-hint"
        />
        <p id="event-search-hint" className="text-sm text-ink-soft">
          Approving an event lets this campaign pay for its verified check-ins. You can revoke it later; payouts already made stand.
        </p>
      </div>
      {state.status === "loading" ? (
        <LoadingRegion label="Loading events" className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </LoadingRegion>
      ) : null}
      {state.status === "error" ? (
        <Notice
          tone="danger"
          title={state.error.message}
          action={
            <Button variant="quiet" onClick={reload} leading={<RetryIcon className="size-4" />}>
              Try again
            </Button>
          }
        >
          {state.error.action}
        </Notice>
      ) : null}
      {state.status === "ready" && results.length === 0 ? (
        <p className="text-sm text-ink-soft">
          {query ? `No events match "${query}".` : "No other events on Showmark yet. Organizers create them at /organize."}
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul aria-label="Events you can approve">
          {results.map((e) => {
            const phase = phases[`approveEvents:${e.id}`] ?? { phase: "idle" };
            return (
              <EventLine
                key={e.id}
                e={e}
                via={seat.signer.kind}
                phase={phase}
                successText="Approved"
                action={
                  <Button variant="secondary" onClick={() => void send("approveEvents", e.id)} pending={isBusy(phase)} disabled={phase.phase === "success"}>
                    {seat.safe ? "Propose approval" : "Approve"}
                  </Button>
                }
              />
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Approved events with live counts, and, for the sponsor, approve and revoke. */
export function EventsPanel({ detail, seat, onChanged }: { detail: SponsorCampaignDetail; seat: SponsorSeat | null; onChanged: () => void }) {
  const approved = detail.events.filter((e) => e.approved);
  const revoked = detail.events.filter((e) => !e.approved && e.settled > 0);
  const { phases, send } = useEventTx(seat, detail.id, onChanged);
  const already = useMemo(() => new Set(approved.map((e) => e.id)), [approved]);
  const via = seat?.signer.kind ?? "wallet";

  return (
    <div className="flex flex-col gap-8">
      {approved.length === 0 ? (
        <EmptyState as="h3" title="No events approved yet">
          {seat
            ? "Find an event below and approve it. Until then this campaign pays only organizers with the required bond, if you allowed that."
            : "This campaign pays for verified check-ins at events its sponsor approves."}
        </EmptyState>
      ) : (
        <ul aria-label="Approved events">
          {approved.map((e) => {
            const phase = phases[`revokeEvents:${e.id}`] ?? { phase: "idle" };
            return (
              <EventLine
                key={e.id}
                e={e}
                via={via}
                phase={seat ? phase : undefined}
                successText="Revoked"
                action={
                  seat ? (
                    <Button variant="quiet" onClick={() => void send("revokeEvents", e.id)} pending={isBusy(phase)} disabled={phase.phase === "success"}>
                      {seat.safe ? "Propose revoke" : "Revoke"}
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        </ul>
      )}
      {revoked.length > 0 ? (
        <p className="text-sm text-ink-soft">
          {revoked.length} revoked {revoked.length === 1 ? "event" : "events"} still {revoked.length === 1 ? "has" : "have"} earlier payouts, listed under payouts.
        </p>
      ) : null}
      {seat ? <AddEvents seat={seat} campaignId={detail.id} already={already} onChanged={onChanged} /> : null}
    </div>
  );
}
