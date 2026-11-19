"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Hex } from "viem";
import { addresses } from "@/lib/chain/addresses";
import { IndexedDbQueueStore, indexedDbAvailable } from "@/lib/door/idb";
import { ALREADY_PRESENT_CODE, DoorQueue, MemoryQueueStore, type QueuedAttestation, type QueueSummary } from "@/lib/door/queue";
import { submitAttestation } from "@/lib/door/relay";
import { signDoorAttest } from "@/lib/door/sign";
import { decodeAttendeeCode, decodeDoorPass } from "@/lib/qr/payload";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { formatCount, formatTime } from "@/ui/format";
import { CheckIcon, CloseIcon, RetryIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";
import { TextField } from "@/ui/Field";
import { TxLink } from "@/ui/TxLink";
import { DoorBar, DoorFrame, DoorSetupView, DoorSignals, DoorWarnings } from "./DoorChrome";
import { useDoorSetup, useWakeLock } from "./use-door";
import { useQrCamera } from "./use-qr-camera";

type Result =
  | { tone: "success"; title: string; body: string; tx: Hex | null }
  | { tone: "queued"; title: string; body: string }
  | { tone: "already"; title: string; body: string }
  | { tone: "failure"; title: string; body: string };

const RESULT_MS = 3_200;
const SAME_CODE_MS = 5_000;
const FLUSH_EVERY_MS = 20_000;

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not every device can vibrate; the colour, icon and words still say what happened.
  }
}

const toneStyle: Record<Result["tone"], { band: string; mark: string; label: string }> = {
  success: { band: "bg-ledger-green text-paper", mark: "bg-paper text-ledger-green", label: "Checked in" },
  already: { band: "bg-stamp-blue text-paper", mark: "bg-paper text-stamp-blue", label: "Already in" },
  queued: { band: "bg-ink text-paper", mark: "bg-paper text-ink", label: "Saved" },
  failure: { band: "bg-vermilion text-on-vermilion", mark: "bg-on-vermilion text-vermilion", label: "Not checked in" },
};

function ResultBand({ result, onDismiss }: { result: Result; onDismiss(): void }) {
  const style = toneStyle[result.tone];
  return (
    <div
      role={result.tone === "failure" ? "alert" : "status"}
      data-testid="scan-result"
      data-tone={result.tone}
      className={cn("flex items-start gap-4 rounded-doc px-5 py-5 shadow-lift animate-[door-result-in_200ms_var(--ease-out-quart)_both]", style.band)}
    >
      <span aria-hidden="true" className={cn("grid size-14 shrink-0 place-items-center rounded-pill", style.mark)}>
        {result.tone === "failure" ? <CloseIcon className="size-8" /> : result.tone === "queued" ? <RetryIcon className="size-8" /> : <CheckIcon className="size-8" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium tracking-[0.1em] uppercase opacity-85">{style.label}</p>
        <p className="font-display text-2xl leading-tight sm:text-3xl">{result.title}</p>
        <p className="text-base opacity-90">{result.body}</p>
        {result.tone === "success" && result.tx ? (
          <TxLink hash={result.tx} className="text-current decoration-current/40">
            View on the explorer
          </TxLink>
        ) : null}
      </div>
      <button type="button" onClick={onDismiss} className="-mt-1 -mr-2 inline-grid size-11 place-items-center rounded-doc opacity-85 hover:opacity-100" aria-label="Dismiss">
        <CloseIcon className="size-5" />
      </button>
    </div>
  );
}

function stateLabel(r: QueuedAttestation): string {
  if (r.state === "sent") return r.txHash ? "Sent" : "Already in";
  if (r.state === "rejected") return "Not recorded";
  return "Waiting to send";
}

export function DoorScanner() {
  const params = useParams<{ eventId: string }>();
  const setup = useDoorSetup(params.eventId);
  const ready = setup.phase.kind === "ready";
  const wake = useWakeLock(ready);
  const queue = useMemo(() => new DoorQueue(indexedDbAvailable() ? new IndexedDbQueueStore() : new MemoryQueueStore()), []);
  const persistent = useMemo(() => indexedDbAvailable(), []);

  const [result, setResult] = useState<Result | null>(null);
  const [summary, setSummary] = useState<QueueSummary>({ pending: 0, sent: 0, rejected: 0 });
  const [recent, setRecent] = useState<QueuedAttestation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const lastCode = useRef<{ text: string; at: number } | null>(null);
  const busy = useRef(false);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const eventKey = setup.eventId?.toString() ?? null;

  const refreshQueue = useCallback(async () => {
    if (!eventKey) return;
    try {
      const [s, list] = await Promise.all([queue.summary(eventKey), queue.list(eventKey)]);
      setSummary(s);
      setRecent(list.slice(0, 12));
    } catch {
      setSyncError("This device could not read its saved check-ins. Reload the page.");
    }
  }, [queue, eventKey]);

  const flush = useCallback(async () => {
    if (!eventKey) return;
    setSyncing(true);
    try {
      const out = await queue.flush(eventKey);
      setSyncError(out.stoppedBy ? `${out.stoppedBy.message} ${out.stoppedBy.action}` : null);
    } catch {
      setSyncError("Saved check-ins could not be read from this device. Reload the page.");
    } finally {
      setSyncing(false);
      await refreshQueue();
    }
  }, [queue, eventKey, refreshQueue]);

  // Read the saved queue once the door is ready, and send it whenever the connection comes back.
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      if (setup.online) void flush();
      else void refreshQueue();
    }, 0);
    return () => clearTimeout(id);
  }, [ready, setup.online, refreshQueue, flush]);

  useEffect(() => {
    if (!ready || summary.pending === 0 || !setup.online) return;
    const id = setInterval(() => void flush(), FLUSH_EVERY_MS);
    return () => clearInterval(id);
  }, [ready, summary.pending, setup.online, flush]);

  const show = useCallback((next: Result) => {
    setResult(next);
    vibrate(next.tone === "failure" ? [90, 60, 90] : next.tone === "queued" ? [40, 40, 40] : 70);
    if (resultTimer.current) clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => setResult(null), RESULT_MS);
  }, []);

  const handleCode = useCallback(
    async (text: string): Promise<boolean> => {
      if (!setup.doorKey || setup.eventId === null) return false;
      const now = Date.now();
      if (busy.current) return false;
      if (lastCode.current && lastCode.current.text === text && now - lastCode.current.at < SAME_CODE_MS) return false;
      lastCode.current = { text, at: now };

      const code = decodeAttendeeCode(text);
      if (!code) {
        show(
          decodeDoorPass(text)
            ? { tone: "failure", title: "That is a door code", body: "Ask the attendee to open their passport and show their own code instead." }
            : { tone: "failure", title: "Not a Showmark code", body: "Ask the attendee to open their passport in Showmark and show the code for this event." },
        );
        return false;
      }
      if (code.eventId !== setup.eventId) {
        show({ tone: "failure", title: "Code for another event", body: `This code is for event ${code.eventId}. Ask the attendee to open the code for this event.` });
        return false;
      }

      busy.current = true;
      try {
        const signed = await signDoorAttest(setup.doorKey, code, setup.clock.clock.nowSeconds(), addresses.registry);
        if (!navigator.onLine) {
          const added = await queue.enqueue(signed);
          show(
            added === "duplicate"
              ? { tone: "already", title: "Already scanned", body: "This code is saved on this device and is sent when the connection is back." }
              : { tone: "queued", title: "Saved on this device", body: "There is no internet right now. The check-in is sent as soon as the connection is back." },
          );
          return true;
        }
        const outcome = await submitAttestation(signed);
        if (outcome.kind === "ok") {
          await queue.recordSent(signed, outcome.value.txHash);
          show({ tone: "success", title: "Welcome in", body: "The stamp is on its way to their passport.", tx: outcome.value.txHash });
        } else if (outcome.kind === "rejected" && outcome.error.code === ALREADY_PRESENT_CODE) {
          await queue.recordSent(signed, null);
          show({ tone: "already", title: "Already checked in", body: "This person is already recorded for this event. Let them in." });
        } else if (outcome.kind === "rejected") {
          show({ tone: "failure", title: outcome.error.message, body: outcome.error.action });
        } else {
          const added = await queue.enqueue(signed);
          show(
            added === "duplicate"
              ? { tone: "already", title: "Already scanned", body: "This code is already saved and waiting to be sent." }
              : { tone: "queued", title: "Saved on this device", body: `${outcome.error.message} It is sent again automatically.` },
          );
        }
        return true;
      } catch {
        show({ tone: "failure", title: "This scan could not be saved", body: "Scan the code again. If it keeps failing, reload this page." });
        return false;
      } finally {
        busy.current = false;
        void refreshQueue();
      }
    },
    [setup.doorKey, setup.eventId, setup.clock.clock, queue, show, refreshQueue],
  );

  const { videoRef, state: cameraState, start: startCamera } = useQrCamera((text) => void handleCode(text));

  function submitManual(event: FormEvent) {
    event.preventDefault();
    const text = manual.trim();
    if (!decodeAttendeeCode(text)) {
      setManualError("That is not an attendee code. It starts with SM2 and is shown under the QR in the attendee’s passport.");
      return;
    }
    setManualError(null);
    lastCode.current = null;
    void handleCode(text).then((ok) => {
      if (ok) setManual("");
    });
  }

  const bar = (
    <DoorBar title="Scan attendee codes">
      {setup.phase.kind !== "not-deployed" && setup.phase.kind !== "invalid-id" ? <DoorSignals setup={setup} wake={ready ? wake : undefined} /> : null}
      {ready && setup.eventId !== null ? <Button href={`/door/${setup.eventId}`}>Show the door code</Button> : null}
    </DoorBar>
  );

  if (!ready || setup.phase.kind !== "ready" || !setup.event) {
    return (
      <DoorFrame bar={bar}>
        <DoorSetupView setup={setup} />
      </DoorFrame>
    );
  }

  const closed = setup.phase.window === "closed";
  const name = setup.details?.metadata.name ?? `Event ${setup.eventId}`;
  const synced = summary.pending === 0;

  return (
    <DoorFrame bar={bar}>
      <DoorWarnings setup={setup} wake={wake} />
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10 lg:py-8">
        <section aria-labelledby="scan-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 id="scan-title" className="font-display text-3xl leading-tight text-ink sm:text-4xl">
                {name}
              </h1>
              <p className="text-base text-ink-soft">Scan each attendee’s passport code. Their check-in is signed by this device and tied to that person.</p>
            </div>
            <p className="text-base text-ink-soft" data-testid="scanner-count">
              <span className="font-display text-3xl text-ink">{formatCount(setup.event.checkedIn)}</span> checked in
            </p>
          </div>

          {closed ? (
            <Notice tone="warning" title="Check-in has closed for this event">
              Scans are no longer accepted. Codes already saved on this device can still be sent below.
            </Notice>
          ) : null}

          <div className="relative overflow-hidden rounded-doc bg-night shadow-sheet">
            <video ref={videoRef} playsInline muted className={cn("aspect-[4/3] w-full object-cover", cameraState.kind !== "running" && "invisible")} />
            {cameraState.kind === "running" ? (
              <span aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-doc shadow-[0_0_0_9999px_rgb(18_17_15/0.35)] ring-2 ring-[#faf7f0]/85" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-[#ede7db]">
                {cameraState.kind === "denied" ? (
                  <>
                    <p className="font-display text-2xl">Camera access is blocked</p>
                    <p className="max-w-sm text-base text-[#a9a296]">Allow the camera for this site in the browser’s address bar settings, then try again. You can also type codes by hand below.</p>
                    <Button variant="primary" onClick={() => void startCamera()}>
                      Try the camera again
                    </Button>
                  </>
                ) : cameraState.kind === "unavailable" ? (
                  <>
                    <p className="font-display text-2xl">No camera</p>
                    <p className="max-w-sm text-base text-[#a9a296]">{cameraState.reason}</p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-2xl">Point the camera at the attendee’s code</p>
                    <Button variant="primary" size="lg" onClick={() => void startCamera()} pending={cameraState.kind === "starting"} disabled={closed}>
                      Start the camera
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          <div aria-live="assertive" className="min-h-[1px]">
            {result ? <ResultBand result={result} onDismiss={() => setResult(null)} /> : null}
          </div>

          <form onSubmit={submitManual} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <TextField
              id="manual-code"
              label="Or type a code"
              hint="For a cracked screen or a dim phone. The code starts with SM2."
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              error={manualError ?? undefined}
              mono
              autoComplete="off"
              spellCheck={false}
              fieldClassName="flex-1"
              disabled={closed}
            />
            <Button type="submit" disabled={closed || manual.trim() === ""} className="sm:mb-[calc(1.5rem+0.5rem)]">
              Check in
            </Button>
          </form>
        </section>

        <section aria-labelledby="queue-title" className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-doc bg-sheet p-5 shadow-sheet grain">
            <div className="flex items-start justify-between gap-4">
              <h2 id="queue-title" className="text-md font-medium">
                Saved on this device
              </h2>
              <span
                data-testid="queue-state"
                className={cn(
                  "inline-flex h-7 items-center gap-2 rounded-pill px-3 text-sm font-medium shadow-[inset_0_0_0_1px_currentColor]",
                  synced ? "text-ledger-green" : "text-vermilion-ink",
                )}
              >
                <span aria-hidden="true" className={cn("size-1.5 rounded-pill", synced ? "bg-ledger-green" : "bg-vermilion")} />
                <span className="text-ink">{synced ? "All sent" : syncing ? "Sending" : "Waiting to send"}</span>
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[
                ["Waiting", summary.pending, "queue-pending"],
                ["Sent", summary.sent, "queue-sent"],
                ["Not recorded", summary.rejected, "queue-rejected"],
              ].map(([label, value, id]) => (
                <div key={label} className="rounded-doc bg-paper-deep px-2 py-3">
                  <dt className="text-sm text-ink-soft">{label}</dt>
                  <dd className="font-display text-3xl text-ink" data-testid={id}>
                    {formatCount(Number(value))}
                  </dd>
                </div>
              ))}
            </dl>
            {syncError ? <p className="text-sm text-ink-soft">{syncError}</p> : null}
            {!persistent ? (
              <Notice tone="warning" title="This browser cannot keep scans after the tab closes">
                Keep this tab open until everything is sent, or use Chrome or Safari outside a private window.
              </Notice>
            ) : null}
            <Button onClick={() => void flush()} pending={syncing} disabled={summary.pending === 0 || !setup.online} leading={<RetryIcon className="size-4" />}>
              {setup.online ? "Send now" : "Waiting for internet"}
            </Button>
            <p className="text-sm text-ink-soft">
              Scans made without internet are signed here and sent in batches when the connection is back. They can be sent until three days after the event ends.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-md font-medium">Recent scans</h2>
            {recent.length === 0 ? (
              <p className="text-base text-ink-soft">No scans yet on this device.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-rule-soft">
                {recent.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <AddressChip address={r.item.attendee} copy={false} link="none" />
                    <span className="flex items-center gap-3 text-sm text-ink-soft">
                      {formatTime(new Date(Number(r.item.doorTime) * 1000).toISOString())}
                      <span className={cn("font-medium", r.state === "rejected" ? "text-vermilion-ink" : r.state === "pending" ? "text-ink" : "text-ledger-green")} title={r.error ? `${r.error.message} ${r.error.action}` : undefined}>
                        {stateLabel(r)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </DoorFrame>
  );
}
