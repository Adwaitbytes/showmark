"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { getEvent, getTxStatus, postCheckIn, type CheckInEvent } from "@/lib/checkin/api";
import { problemCopy } from "@/lib/checkin/copy";
import type { Dictionary, Locale } from "@/lib/checkin/i18n";
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
import { signCheckIn, type CheckInRequest } from "@/lib/checkin/sign";
import { decodeDoorPass } from "@/lib/qr/payload";
import { ensurePass, PassUnavailableError } from "@/lib/wallet/pass";
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

type ScreenPhase = { kind: "starting" } | { kind: "invalid" } | { kind: "storage" } | CheckInPhase;

type EventState = { status: "loading" } | { status: "ready"; event: CheckInEvent } | { status: "failed" };

/** A stamp the person already had for this event, found on this phone or in the index. */
interface PriorStamp {
  at: string;
  tx: Hex | null;
}

const CHECK_IN_MARGIN_MS = 60 * 60_000;

function decodeToken(raw: string | string[] | undefined) {
  if (typeof raw !== "string") return null;
  try {
    return decodeDoorPass(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/**
 * The door QR opens here. The check-in starts on load: scanning the code is the intent, a tap
 * would only cost a second of the door code's short life, and checking in twice is harmless
 * because the registry records one presence per event and person.
 */
export function CheckInScreen() {
  const params = useParams<{ token: string }>();
  const door = useMemo(() => decodeToken(params.token), [params.token]);
  const eventId = door ? door.eventId.toString() : null;
  const { locale, t } = useLocale();

  const [phase, setPhase] = useState<ScreenPhase>(() => (door ? { kind: "starting" } : { kind: "invalid" }));
  const [event, setEvent] = useState<EventState>({ status: "loading" });
  const [pass, setPass] = useState<Address | null>(null);
  const [prior, setPrior] = useState<PriorStamp | null>(null);
  const [showLinkPrompt, setShowLinkPrompt] = useState(false);
  const [runKey, setRunKey] = useState(0);

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

    const deps: CheckInDeps = {
      postCheckIn: (request, s) => postCheckIn(request, { signal: s }),
      txStatus: (hash, s) => getTxStatus(hash, { signal: s }),
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
      let request = requestRef.current;
      if (!request) {
        try {
          const account = ensurePass();
          setPass(account.address);
          request = await signCheckIn(account, door);
          requestRef.current = request;
        } catch (error) {
          finishedRef.current = true;
          setPhase(error instanceof PassUnavailableError ? { kind: "storage" } : { kind: "failed", problem: { kind: "rejected", code: "sign_failed", retryable: false } });
          return;
        }
      } else {
        setPass(request.attendee);
      }
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
  }, [door, runKey, waiter]);

  // Once the stamp is in: keep it on this phone for the passport, look up an earlier stamp, and
  // decide whether to suggest linking a wallet.
  useEffect(() => {
    if (!pass || !eventId || (phase.kind !== "stamped" && phase.kind !== "already")) return;
    const controller = new AbortController();
    const eventName = eventNameRef.current ?? t.common.eventFallback(eventId);

    if (phase.kind === "stamped") {
      recordLocalStamp({
        eventId,
        eventName,
        city: event.status === "ready" ? event.event.metadata.city : "",
        at: new Date(phase.at).toISOString(),
        mode: 1,
        tx: phase.txHash,
        streak: 0,
        holder: pass,
      });
    } else {
      const local = localStamps(pass).find((s) => s.eventId === eventId);
      if (local) setPrior({ at: local.at, tx: local.tx });
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
  }, [phase, pass, eventId]);

  const now = useNow(phase.kind === "waiting" && phase.retryAt !== null);
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
      <EventHeading event={event} eventName={eventName} done={done} hidden={phase.kind === "invalid"} />

      <Sheet as="section" aria-labelledby="check-in-status" className="overflow-hidden">
        {phase.kind === "invalid" || phase.kind === "storage" || phase.kind === "failed" ? (
          <SheetSection>
            <FailedState phase={phase} eventStartsAt={loadedEvent?.startsAt ?? null} onRetry={retry} />
          </SheetSection>
        ) : (
          <>
            <SheetSection className="flex flex-col items-center gap-5 pt-8 text-center sm:pt-10">
              <StampStage phase={phase} pass={pass} eventId={eventId ?? "0"} eventName={eventName} city={loadedEvent?.metadata.city ?? ""} prior={prior} startsAt={loadedEvent?.startsAt ?? null} />
              <div role="status" aria-live="polite" className="flex max-w-[24rem] flex-col items-center gap-2">
                <h1 id="check-in-status" className="font-display text-2xl text-ink">
                  {headline(phase, t)}
                </h1>
                <p className="text-base text-ink-soft">{hint(phase, t, locale, now)}</p>
              </div>
              {phase.kind === "waiting" ? (
                <Button variant="quiet" onClick={() => waiter.wake()} leading={<RetryIcon className="size-4" />}>
                  {t.common.retryNow}
                </Button>
              ) : null}
              {done ? (
                <Button href="/pass" variant="secondary" size="lg" block className="max-w-[20rem]">
                  {t.checkIn.openPassport}
                </Button>
              ) : null}
            </SheetSection>
            <Perforation />
            <SheetSection>
              <Receipt phase={phase} prior={prior} eventName={eventName} />
            </SheetSection>
          </>
        )}
      </Sheet>

      {done && showLinkPrompt ? (
        <Notice
          tone="info"
          title={t.checkIn.linkPromptTitle}
          action={
            <div className="flex flex-wrap gap-3">
              <Button href="/pass/link" variant="primary">
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

      {phase.kind !== "invalid" ? <Rewards event={event} /> : null}

      <p className="text-sm text-ink-soft">{t.checkIn.noWalletNeeded}</p>
    </div>
  );
}

function FailedState({ phase, eventStartsAt, onRetry }: { phase: ScreenPhase; eventStartsAt: string | null; onRetry: () => void }) {
const { locale, t } = useLocale();
  if (phase.kind === "invalid" || phase.kind === "storage") {
    const copy = phase.kind === "invalid" ? t.errors.invalidCode : t.errors.storage;
    return (
      <ErrorState
        as="h1"
        title={copy.message}
        action={
          phase.kind === "invalid" ? (
            <Button href="/scan" variant="primary">
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
  const copy = problemCopy(problem, locale, t);
  const opensAt =
    problem.kind === "window" && eventStartsAt && Date.parse(eventStartsAt) - CHECK_IN_MARGIN_MS > Date.now()
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
          ) : problem.kind === "unconfirmed" ? (
            <Button href="/pass" variant="secondary">
              {t.checkIn.openPassport}
            </Button>
          ) : (
            <Button href="/scan" variant="primary">
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

function hint(phase: ScreenPhase, t: Dictionary, locale: Locale, now: number): string {
  switch (phase.kind) {
    case "starting":
    case "sending":
      return t.checkIn.sendingHint;
    case "waiting": {
      const copy = problemCopy(phase.problem, locale, t);
      const countdown = phase.retryAt === null ? "" : ` ${t.errors.retryIn(Math.max(1, Math.ceil((phase.retryAt - now) / 1000)))}`;
      return `${copy.message} ${copy.action}${countdown}`;
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
      <p className="text-sm font-medium tracking-[0.08em] text-ink-soft uppercase">{done ? t.checkIn.eyebrowDone : t.checkIn.eyebrow}</p>
      {event.status === "loading" ? (
        <div className="flex flex-col gap-2.5 pt-1" aria-hidden="true">
          <Skeleton className="h-9 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : (
        <>
          <p className="font-display text-2xl text-ink sm:text-3xl">{eventName}</p>
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
}

/** Where the stamp lands: a faint impression while the network works, then the press. */
function StampStage({ phase, pass, eventId, eventName, city, prior, startsAt }: StampStageProps) {
  const { t } = useLocale();
  const [openedAt] = useState(() => new Date().toISOString());
  const base = { eventId, eventName, city, mode: 1 as const, holder: pass ?? undefined, className: "w-48 sm:w-52" };

  let content: React.ReactNode;
  if (phase.kind === "stamped") {
    content = (
      <StampPress pressKey={phase.txHash}>
        <Stamp {...base} at={new Date(phase.at).toISOString()} />
      </StampPress>
    );
  } else if (phase.kind === "already") {
    content = <Stamp {...base} at={prior?.at ?? startsAt ?? openedAt} />;
  } else if (pass) {
    content = (
      <>
        <span className="block animate-ink-wait opacity-30 grayscale" aria-hidden="true">
          <Stamp {...base} at={openedAt} />
        </span>
        <span className="sr-only">{t.checkIn.pendingStampLabel(eventName)}</span>
      </>
    );
  } else {
    content = <SkeletonStamp className="w-48 sm:w-52" />;
  }

  return <div className="grid min-h-52 place-items-center sm:min-h-56">{content}</div>;
}

function Receipt({ phase, prior, eventName }: { phase: ScreenPhase; prior: PriorStamp | null; eventName: string }) {
  const { t } = useLocale();
  const at = phase.kind === "stamped" ? new Date(phase.at).toISOString() : phase.kind === "already" ? (prior?.at ?? null) : null;
  const tx = phase.kind === "stamped" || phase.kind === "confirming" ? phase.txHash : phase.kind === "already" ? (prior?.tx ?? null) : null;
  return (
    <Ledger label={t.checkIn.receiptLabel}>
      <LedgerRow label={t.checkIn.receiptEvent} value={<span className="font-sans">{eventName}</span>} />
      <LedgerRow
        label={t.checkIn.receiptTime}
        value={at ? `${formatDate(at)}, ${formatTime(at)}` : <span className="font-sans text-ink-soft">{t.checkIn.receiptPending}</span>}
      />
      <LedgerRow
        label={t.checkIn.receiptTx}
        value={tx ? <TxLink hash={tx} /> : <span className="font-sans text-ink-soft">{t.checkIn.receiptPending}</span>}
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

