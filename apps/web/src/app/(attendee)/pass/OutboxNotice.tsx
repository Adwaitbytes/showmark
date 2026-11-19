"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getTxStatus, postCheckIn } from "@/lib/checkin/api";
import { problemCopy } from "@/lib/checkin/copy";
import { recordLocalStamp, removeFromOutbox, type OutboxEntry } from "@/lib/checkin/local-records";
import { useLocale } from "@/lib/checkin/locale";
import { createWaiter, runCheckIn, type CheckInPhase } from "@/lib/checkin/machine";
import { Button } from "@/ui/Button";
import { RetryIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";

/**
 * A signed check-in that never reached the network (the relay was down or the phone went offline
 * and the screen was closed). One tap sends it again. A door code that has gone stale in the
 * meantime comes back as such, and the notice says to scan the current code.
 */
export function OutboxNotice({ entry, onSettled }: { entry: OutboxEntry; onSettled: () => void }) {
  const { t, errors } = useLocale();
  const [phase, setPhase] = useState<CheckInPhase | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const waiter = useMemo(() => createWaiter(), []);
  const eventName = entry.eventName ?? t.common.eventFallback(entry.request.eventId);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function send() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const final = await runCheckIn(
      entry.request,
      {
        postCheckIn: (request, signal) => postCheckIn(request, { signal }),
        txStatus: (hash, signal) => getTxStatus(hash, { signal }),
        now: Date.now,
        isOnline: () => navigator.onLine,
        wait: waiter.wait,
        outbox: { save: () => undefined, remove: (request) => removeFromOutbox(request) },
      },
      setPhase,
      controller.signal,
      { maxAttempts: 1, pollMs: 700, confirmTimeoutMs: 45_000, presencePollMs: 1_000 },
    );
    if (final?.kind === "stamped" && final.txHash) {
      recordLocalStamp({
        eventId: entry.request.eventId,
        eventName,
        city: "",
        at: new Date(final.at).toISOString(),
        mode: 1,
        tx: final.txHash,
        streak: 0,
        holder: entry.request.attendee,
      });
    }
    if (final && final.kind !== "failed") onSettled();
  }

  const busy = phase?.kind === "sending" || phase?.kind === "confirming";
  const failure = phase?.kind === "failed" ? problemCopy(phase.problem, t, errors) : null;
  const finalFailure = phase?.kind === "failed" && !phase.problem.retryable;

  return (
    <Notice
      tone={failure ? "danger" : "warning"}
      title={failure ? failure.message : t.pass.outboxTitle}
      action={
        finalFailure ? (
          <Button href="/scan" variant="primary">
            {t.checkIn.scanAgain}
          </Button>
        ) : (
          <Button variant="primary" pending={busy} onClick={send} leading={<RetryIcon className="size-4" />}>
            {phase?.kind === "confirming" ? t.checkIn.confirming : t.pass.outboxSend}
          </Button>
        )
      }
    >
      {failure ? failure.action : t.pass.outboxBody(eventName)}
    </Notice>
  );
}
