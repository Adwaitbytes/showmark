"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { getEvent, getQueuedCheckIn, getTxStatus, postCheckIn, type CheckInEvent } from "@/lib/checkin/api";
import { problemCopy } from "@/lib/checkin/copy";
import type { Dictionary, ErrorTables } from "@/lib/checkin/i18n";
import {
  dismissLinkPrompt,
  linkPromptDismissed,
  localStamps,
  recordLocalStamp,
  rememberEvent,
  removeFromOutbox,
  saveToOutbox,
} from "@/lib/checkin/local-records";
import { useLocale } from "@/lib/checkin/locale";
import { createWaiter, runCheckIn, type CheckInDeps, type CheckInPhase } from "@/lib/checkin/machine";
import { raceTxStatus } from "@/lib/checkin/tx-race";
import { passAndSign, type SignResult } from "@/lib/checkin/pass-signer";
import type { CheckInRequest } from "@/lib/checkin/sign";
import { useDoorLocation, type DoorCode } from "@/lib/checkin/door-fragment";
import { earlyCheckInFor, startEarlyCheckIn } from "@/lib/checkin/early";
import { Amount } from "@/ui/Amount";
import { Button } from "@/ui/Button";
import { ErrorState } from "@/ui/ErrorState";
import { formatDate, formatEventWindow, formatTime } from "@/ui/format";
import { RetryIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { Notice } from "@/ui/Notice";
import { Perforation } from "@/ui/Perforation";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { Skeleton, SkeletonStamp } from "@/ui/Skeleton";
import { Stamp } from "@/ui/stamp/Stamp";
import { StampPress } from "@/ui/stamp/StampPress";
import { TxLink } from "@/ui/TxLink";
import { useNow } from "../../_components/useNow";

type ScreenPhase = { kind: "starting" } | { kind: "invalid" } | { kind: "missing-key" } | { kind: "storage" } | CheckInPhase;

type EventState = { status: "loading" } | { status: "ready"; event: CheckInEvent } | { status: "failed" };

/** A stamp the person already had for this event, found on this phone or in the index. */
interface PriorStamp {
  at: string;
  tx: Hex | null;
}

const CHECK_IN_MARGIN_MS = 60 * 60_000;

// Start the check-in as soon as this code runs in the browser, before hydration (see early.ts).
startEarlyCheckIn();

// Direct chain reads (presence, receipts, the CheckedIn log), fetched while the relay request is out.
let chainWatch: Promise<typeof import("@/lib/checkin/chain-watch")> | null = null;
function loadChainWatch() {
  chainWatch ??= import("@/lib/checkin/chain-watch");
  chainWatch.catch(() => {
    chainWatch = null;
  });
  return chainWatch;
}

/**
 * The door QR opens here. The check-in starts on load: scanning the code is the intent, a tap
 * would only cost a second of the door code's short life, and checking in twice is harmless
 * because the registry records one presence per event and person.
 */
export function CheckInScreen() {
  const { token, fragment, code } = useDoorLocation();
  // A new door code (a second scan in the same tab) gets a fresh screen, not the last one's state.
  return <CheckInFlow key={`${token ?? ""}#${fragment ?? ""}`} code={code} token={token} fragment={fragment} />;
}

function CheckInFlow({ code, token, fragment }: { code: DoorCode; token: string | null; fragment: string | null }) {
  const door = code.status === "ok" ? code.door : null;
  const eventId = door ? door.eventId.toString() : null;
  const { t, errors } = useLocale();

  // Starts as "starting" everywhere, including the server render, so a valid code never flashes an error.
  const [checkInPhase, setPhase] = useState<ScreenPhase>({ kind: "starting" });
  const phase: ScreenPhase =
    code.status === "invalid" ? { kind: "invalid" } : code.status === "missing-key" ? { kind: "missing-key" } : checkInPhase;
  const badCode = phase.kind === "invalid" || phase.kind === "missing-key";
  const [event, setEvent] = useState<EventState>({ status: "loading" });
  const [pass, setPass] = useState<Address | null>(null);
  const [prior, setPrior] = useState<PriorStamp | null>(null);
  const [showLinkPrompt, setShowLinkPrompt] = useState(false);
  const [runKey, setRunKey] = useState(0);
  // Set when the stamp was confirmed by reading the chain directly and the transaction is looked up after.
  const [foundTx, setFoundTx] = useState<Hex | null>(null);

  const requestRef = useRef<CheckInRequest | null>(null);
  const finishedRef = useRef(false);
  const eventNameRef = useRef<string | null>(null);
  const waiter = useMemo(() => createWaiter(), []);

  // Event details load next to the check-in, never in front of it.
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    rememberEvent({ eventId, name: null, openedAt: Date.now() });
    getEvent(eventId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        eventNameRef.current = result.data.metadata.name;
        rememberEvent({ eventId, name: result.data.metadata.name, openedAt: Date.now() });
        setEvent({ status: "ready", event: result.data });
      } else {
        setEvent({ status: "failed" });
      }
    });
    return () => controller.abort();
  }, [eventId]);

  // The check-in itself. Reruns only for a manual retry; a finished check-in never repeats when the
  // screen is shown again.
  useEffect(() => {
    if (!door || finishedRef.current) return;
    const controller = new AbortController();
    const { signal } = controller;

    const early = token !== null && fragment !== null ? earlyCheckInFor(token, fragment) : null;
    const deps: CheckInDeps = {
      async postCheckIn(request, s) {
        // The first send already left before hydration; take its answer instead of sending again.
        if (early && !early.adopted) {
          const result = await early.post;
          if (result && !s.aborted) {
            early.adopted = true;
            return result;
          }
          if (result) return result;
        }
        return postCheckIn(request, { signal: s });
      },
      queuedStatus: (id, s) => getQueuedCheckIn(id, { signal: s }),
      async txStatus(hash, s) {
        const request = requestRef.current;
        const who = request ? { eventId: request.eventId, attendee: request.attendee } : undefined;
        const api = getTxStatus(hash, { signal: s }, who);
        const result = await raceTxStatus(
          loadChainWatch().then((m) => m.chainReceipt(hash)),
          api,
        );
        // A mined batch can reject one item. When the chain's receipt answered, confirm this attendee's
        // presence before stamping; if it is not there, the API says why.
        if (request && result.ok && result.data.status === "success" && result.data.checkIn === undefined) {
          const present = await loadChainWatch().then((m) => m.chainPresence(BigInt(request.eventId), request.attendee));
          if (present === false) return api;
        }
        return result;
      },
      presence: (request, s) => (s.aborted ? Promise.resolve(null) : loadChainWatch().then((m) => m.chainPresence(BigInt(request.eventId), request.attendee))),
      now: Date.now,
      isOnline: () => navigator.onLine,
      wait: waiter.wait,
      outbox: {
        save: (request) => saveToOutbox({ request, eventName: eventNameRef.current, savedAt: Date.now() }),
        remove: (request) => removeFromOutbox(request),
      },
    };

    async function go() {
      if (!door) return;
      void loadChainWatch();
      let request = requestRef.current;
      if (!request) {
        let signed: SignResult;
        try {
          signed = early ? await early.signed : await passAndSign(door);
        } catch {
          // Signing failed unexpectedly: offer a retry, as when the relay is out of reach.
          signed = { ok: false, reason: "sign" };
        }
        if (signal.aborted) return;
        if (!signed.ok) {
          finishedRef.current = signed.reason === "storage";
          setPhase(
            signed.reason === "storage"
              ? { kind: "storage" }
              : { kind: "failed", problem: { kind: "relay", code: "sign_failed", retryable: true } },
          );
          return;
        }
        request = signed.request;
        requestRef.current = request;
      }
      setPass(request.attendee);
      const final = await runCheckIn(request, deps, setPhase, signal);
      if (final && !(final.kind === "failed" && final.problem.retryable)) finishedRef.current = true;
    }

    void go();
    const wake = () => waiter.wake();
    window.addEventListener("online", wake);
    return () => {
      controller.abort();
      window.removeEventListener("online", wake);
    };
  }, [door, runKey, waiter, token, fragment]);

  // Presence was seen on chain before the relay answered: find the transaction from the CheckedIn log.
  const needsTx = phase.kind === "stamped" && phase.txHash === null && !foundTx;
  useEffect(() => {
    if (!needsTx || !pass || !eventId) return;
    let cancelled = false;
    (async () => {
      const { findCheckInTx } = await loadChainWatch();
      for (let attempt = 0; attempt < 15 && !cancelled; attempt++) {
        const tx = await findCheckInTx(BigInt(eventId), pass);
        if (cancelled) return;
        if (tx) {
          setFoundTx(tx);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    })().catch(() => {
      // The stamp stands without a link; the passport shows the transaction once indexed.
    });
    return () => {
      cancelled = true;
    };
  }, [needsTx, pass, eventId]);
  const stampTx = phase.kind === "stamped" ? (phase.txHash ?? foundTx) : null;

  // Once the stamp is in: keep it on this phone for the passport, look up an earlier stamp, and
  // decide whether to suggest linking a wallet.
  useEffect(() => {
    if (!pass || !eventId || (phase.kind !== "stamped" && phase.kind !== "already")) return;
    const controller = new AbortController();
    const eventName = eventNameRef.current ?? t.common.eventFallback(eventId);

    if (phase.kind === "stamped" && stampTx) {
      recordLocalStamp({
        eventId,
        eventName,
        city: event.status === "ready" ? event.event.metadata.city : "",
        at: new Date(phase.at).toISOString(),
        mode: 1,
        tx: stampTx,
        streak: 0,
        holder: pass,
      });
    }

    import("@/lib/checkin/api-passport")
      .then(async ({ getPassport, linkedWalletOf }) => ({ result: await getPassport(pass, { signal: controller.signal }), linkedWalletOf }))
      .then(({ result, linkedWalletOf }) => {
        if (controller.signal.aborted || !result.ok) return;
        if (phase.kind === "already") {
          const indexed = result.data.stamps.find((s) => s.eventId === eventId);
          if (indexed) setPrior({ at: indexed.at, tx: indexed.tx });
        }
        setShowLinkPrompt(linkedWalletOf(result.data, pass) === null && !linkPromptDismissed());
      })
      .catch(() => {
        // The prompt is optional; without the passport the screen simply does not show it.
      });
    return () => controller.abort();
    // eventFallback only formats the id; the stamp is recorded once per phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pass, eventId, stampTx]);

  const now = useNow(phase.kind === "waiting" && phase.retryAt !== null, phase.kind === "waiting" ? phase.retryAt : null);
  // A stamp this phone confirmed earlier answers "already checked in" before the index does.
  const localPrior = useMemo<PriorStamp | null>(() => {
    if (phase.kind !== "already" || !pass || !eventId) return null;
    const local = localStamps(pass).find((s) => s.eventId === eventId);
    return local ? { at: local.at, tx: local.tx } : null;
  }, [phase.kind, pass, eventId]);
  const priorStamp = prior ?? localPrior;
  const loadedEvent = event.status === "ready" ? event.event : null;
  const eventName = loadedEvent?.metadata.name ?? (eventId ? t.common.eventFallback(eventId) : "");
  const done = phase.kind === "stamped" || phase.kind === "already";

  function retry() {
    finishedRef.current = false;
    setPhase({ kind: "starting" });
    setRunKey((k) => k + 1);
  }

  return (
    <div className="mx-auto flex w-full max-w-[32rem] flex-col gap-6 px-4 pt-6 sm:pt-10">
      <EventHeading event={event} eventName={eventName} done={done} hidden={badCode} />

      <Sheet as="section" aria-labelledby="check-in-status" className="overflow-hidden">
        {badCode || phase.kind === "storage" || phase.kind === "failed" ? (
          <SheetSection>
            <FailedState phase={phase} eventStartsAt={loadedEvent?.startsAt ?? null} onRetry={retry} />
          </SheetSection>
        ) : (
          <>
            <SheetSection className="flex flex-col items-center gap-5 pt-8 text-center sm:pt-10">
              <StampStage phase={phase} pass={pass} eventId={eventId ?? "0"} eventName={eventName} city={loadedEvent?.metadata.city ?? ""} prior={priorStamp} startsAt={loadedEvent?.startsAt ?? null} issuedAt={door ? new Date(Number(door.issuedAt) * 1000).toISOString() : null} />
              <div role="status" aria-live="polite" className="flex max-w-[24rem] flex-col items-center gap-2">
                <h1 id="check-in-status" className="font-display text-3xl text-ink sm:text-4xl">
                  {headline(phase, t)}
                </h1>
                <p className="max-w-[22rem] text-base text-ink-soft">{hint(phase, t, errors, now)}</p>
              </div>
              {phase.kind === "waiting" ? (
                <Button variant="quiet" onClick={() => waiter.wake()} leading={<RetryIcon className="size-4" />}>
                  {t.common.retryNow}
                </Button>
              ) : null}
              {done ? (
                <Button href="/pass" prefetch={false} variant="secondary" size="lg" block className="max-w-[20rem]">
                  {t.checkIn.openPassport}
                </Button>
              ) : null}
            </SheetSection>
            <Perforation />
            <SheetSection>
              <Receipt phase={phase} prior={priorStamp} stampTx={stampTx} />
            </SheetSection>
          </>
        )}
      </Sheet>

      {badCode ? null : <Rewards event={event} />}

      {done && showLinkPrompt ? (
        <Notice
          tone="info"
          title={t.checkIn.linkPromptTitle}
          action={
            <div className="flex flex-wrap gap-3">
              <Button href="/pass/link" prefetch={false} variant="secondary">
                {t.checkIn.linkNow}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  dismissLinkPrompt();
                  setShowLinkPrompt(false);
                }}
              >
                {t.checkIn.notNow}
              </Button>
            </div>
          }
        >
          {t.checkIn.linkWhy}
        </Notice>
      ) : null}


      <p className="text-sm text-ink-soft">{t.checkIn.noWalletNeeded}</p>
    </div>
  );
}

function FailedState({ phase, eventStartsAt, onRetry }: { phase: ScreenPhase; eventStartsAt: string | null; onRetry: () => void }) {
  const { t, errors } = useLocale();
  const [shownAt] = useState(Date.now);
  if (phase.kind === "invalid" || phase.kind === "missing-key" || phase.kind === "storage") {
    const copy = phase.kind === "invalid" ? t.errors.invalidCode : phase.kind === "missing-key" ? t.errors.missingKey : t.errors.storage;
    return (
      <ErrorState
        as="h1"
        title={copy.message}
        action={
          phase.kind !== "storage" ? (
            <Button href="/scan" prefetch={false} variant="primary">
              {t.checkIn.scanAgain}
            </Button>
          ) : null
        }
      >
        {copy.action}
      </ErrorState>
    );
  }
  if (phase.kind !== "failed") return null;
  const { problem } = phase;
  const copy = problemCopy(problem, t, errors);
  const opensAt =
    problem.kind === "window" && eventStartsAt && Date.parse(eventStartsAt) - CHECK_IN_MARGIN_MS > shownAt
      ? new Date(Date.parse(eventStartsAt) - CHECK_IN_MARGIN_MS).toISOString()
      : null;
  return (
    <ErrorState
      as="h1"
      title={copy.message}
      action={
        <>
          {problem.retryable ? (
            <Button variant="primary" onClick={onRetry} leading={<RetryIcon className="size-4" />}>
              {t.common.retry}
            </Button>
          ) : problem.kind === "unconfirmed" || problem.kind === "capacity" || problem.kind === "window" ? (
            <Button href="/pass" prefetch={false} variant="secondary">
              {t.checkIn.openPassport}
            </Button>
          ) : (
            <Button href="/scan" prefetch={false} variant="primary">
              {t.checkIn.scanAgain}
            </Button>
          )}
          {phase.txHash ? <TxLink hash={phase.txHash}>{t.common.explorer}</TxLink> : null}
        </>
      }
    >
      <p>{copy.action}</p>
      {opensAt ? <p className="mt-2 font-medium text-ink">{t.checkIn.opensAt(`${formatDate(opensAt)}, ${formatTime(opensAt)}`)}</p> : null}
    </ErrorState>
  );
}

function headline(phase: ScreenPhase, t: Dictionary): string {
  switch (phase.kind) {
    case "starting":
    case "sending":
    case "queued":
      return t.checkIn.sending;
    case "waiting":
      return t.checkIn.waitingTitle;
    case "confirming":
      return t.checkIn.confirming;
    case "stamped":
      return t.checkIn.stamped;
    case "already":
      return t.checkIn.already;
    default:
      return "";
  }
}

function hint(phase: ScreenPhase, t: Dictionary, errors: ErrorTables | null, now: number): string {
  switch (phase.kind) {
    case "starting":
    case "sending":
      return t.checkIn.sendingHint;
    case "queued":
      return t.checkIn.queuedHint;
    case "waiting": {
      const copy = problemCopy(phase.problem, t, errors);
      const countdown = phase.retryAt === null || now === 0 ? "" : ` ${t.errors.retryIn(Math.max(1, Math.ceil((phase.retryAt - now) / 1000)))}`;
      return `${copy.message} ${copy.action}${countdown}`.trim();
    }
    case "confirming":
      return t.checkIn.confirmingHint;
    case "stamped":
      return t.checkIn.stampedHint;
    case "already":
      return t.checkIn.alreadyHint;
    default:
      return "";
  }
}

function EventHeading({ event, eventName, done, hidden }: { event: EventState; eventName: string; done: boolean; hidden: boolean }) {
  const { t } = useLocale();
  if (hidden) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium tracking-[0.08em] text-ink-soft uppercase [:lang(hi)_&]:tracking-normal">{done ? t.checkIn.eyebrowDone : t.checkIn.eyebrow}</p>
      {event.status === "loading" ? (
        <div className="flex flex-col gap-2.5 pt-1" aria-hidden="true">
          <Skeleton className="h-9 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : (
        <>
          <p className="font-display text-xl text-ink sm:text-2xl">{eventName}</p>
          {event.status === "ready" ? (
            <p className="text-base text-ink-soft">
              {[event.event.metadata.venue, event.event.metadata.city].filter(Boolean).join(", ")}
              <br />
              <span className="font-mono text-sm">{formatEventWindow(event.event.startsAt, event.event.endsAt)}</span>
            </p>
          ) : (
            <p className="text-sm text-ink-soft">{t.checkIn.eventLoadFailed}</p>
          )}
        </>
      )}
    </div>
  );
}

interface StampStageProps {
  phase: ScreenPhase;
  pass: Address | null;
  eventId: string;
  eventName: string;
  city: string;
  prior: PriorStamp | null;
  startsAt: string | null;
  /** When the door showed this code; dates the faint stamp without reading the clock during render. */
  issuedAt: string | null;
}

/** Where the stamp lands: a faint impression while the network works, then the press. */
function StampStage({ phase, pass, eventId, eventName, city, prior, startsAt, issuedAt }: StampStageProps) {
  const { t } = useLocale();
  const openedAt = issuedAt ?? startsAt;
  const base = { eventId, eventName, city, mode: 1 as const, holder: pass ?? undefined, className: "w-60 sm:w-64" };

  let content: React.ReactNode;
  if (phase.kind === "stamped") {
    content = (
      <StampPress pressKey={phase.txHash ?? `chain-${phase.at}`}>
        <Stamp {...base} at={new Date(phase.at).toISOString()} />
      </StampPress>
    );
  } else if (phase.kind === "already") {
    const at = prior?.at ?? openedAt;
    content = at ? <Stamp {...base} at={at} /> : <SkeletonStamp className="w-60 sm:w-64" />;
  } else if (pass && openedAt) {
    content = (
      <>
        <span className="block animate-ink-wait opacity-30 grayscale" aria-hidden="true">
          <Stamp {...base} at={openedAt} />
        </span>
        <span className="sr-only">{t.checkIn.pendingStampLabel(eventName)}</span>
      </>
    );
  } else {
    content = <SkeletonStamp className="w-60 sm:w-64" />;
  }

  return <div className="grid min-h-64 place-items-center sm:min-h-72">{content}</div>;
}

function Receipt({ phase, prior, stampTx }: { phase: ScreenPhase; prior: PriorStamp | null; stampTx: Hex | null }) {
  const { t } = useLocale();
  const at = phase.kind === "stamped" ? new Date(phase.at).toISOString() : phase.kind === "already" ? (prior?.at ?? null) : null;
  const tx = phase.kind === "stamped" ? stampTx : phase.kind === "confirming" ? phase.txHash : phase.kind === "already" ? (prior?.tx ?? null) : null;
  if (phase.kind === "already" && !at && !tx) return null;
  const waitingWord =
    phase.kind === "confirming" || phase.kind === "queued"
      ? t.checkIn.receiptPending
      : phase.kind === "stamped"
        ? t.checkIn.receiptTxLoading
        : phase.kind === "already"
          ? t.checkIn.receiptEarlier
          : t.checkIn.receiptNotSent;
  return (
    <Ledger label={t.checkIn.receiptLabel}>
      <LedgerRow
        label={t.checkIn.receiptTime}
        value={at ? `${formatDate(at)}, ${formatTime(at)}` : <span className="font-sans text-ink-soft">{waitingWord}</span>}
      />
      <LedgerRow
        label={t.checkIn.receiptTx}
        value={tx ? <TxLink hash={tx} /> : <span className="font-sans text-ink-soft">{waitingWord}</span>}
      />
    </Ledger>
  );
}

function Rewards({ event }: { event: EventState }) {
  const { t } = useLocale();
  if (event.status !== "ready") return null;
  const { campaigns } = event.event;
  return (
    <section aria-labelledby="rewards-title" className="flex flex-col gap-3">
      <h2 id="rewards-title" className="font-display text-xl text-ink">
        {t.checkIn.rewardsTitle}
      </h2>
      {campaigns.length === 0 ? (
        <p className="text-base text-ink-soft">{t.checkIn.noRewards}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule-soft border-y border-rule-soft">
          {campaigns.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 py-3.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-base text-ink">{t.checkIn.rewardLine(c.sponsorName)}</span>
                <Amount value={c.attendeeAmount} symbol={c.tokenSymbol} className="text-md text-ink" />
              </div>
              {c.requireQieId ? <span className="text-sm text-ink-soft">{t.checkIn.rewardNeedsQieId}</span> : null}
              {c.minProofMode === 2 ? <span className="text-sm text-ink-soft">{t.checkIn.rewardDoorScan}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

