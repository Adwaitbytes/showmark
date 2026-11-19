"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { isDeployed } from "@/lib/chain/addresses";
import { judgesDeskEventId } from "@/lib/copy/site";
import { ROTATION_MS } from "@/lib/door/rotation";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ArrowRightIcon } from "@/ui/icons";
import { api, ApiRequestError, errorCopy, requestJson, type ErrorCopy } from "../../_lib/api";
import { readEvent } from "../../_lib/chain";
import { usePoll } from "../../_lib/use-poll";
import { DoorBar, DoorFrame } from "./DoorChrome";
import { DoorCode } from "./DoorCode";
import { LiveCount } from "./LiveCount";
import { doorQrSvg } from "./RotatingCode";
import { COUNT_POLL_MS, useFullscreen, useWakeLock } from "./use-door";

// The judges' desk: a door screen with no door laptop. The server signs a fresh pass for the desk event on every
// request, so this page only fetches one every 15 seconds and draws it.

const passSchema = z.object({
  url: z.string().regex(/^https?:\/\/[^\s]+\/c\/\d+\.\d+\.[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$/),
  issuedAt: z.string(),
  expiresAt: z.string(),
});

interface DeskCode {
  url: string;
  svg: string;
  issuedAt: string;
  expiresAt: number;
  receivedAt: number;
}

const HONEST_LINE = "This desk is run by the Showmark team so judges can try a real check-in from their own phone. Its pool is team-funded.";

function useDeskPass(enabled: boolean) {
  const [code, setCode] = useState<DeskCode | null>(null);
  const [error, setError] = useState<ErrorCopy | null>(null);
  // Starts at 0 so the server prerender never reads the clock; the first pass and the tick set real time.
  const [now, setNow] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPass = useCallback(async () => {
    try {
      const pass = await requestJson("/api/judges-desk/pass", passSchema);
      const svg = await doorQrSvg(pass.url);
      const receivedAt = Date.now();
      setNow(receivedAt);
      setCode({ url: pass.url, svg, issuedAt: String(Math.floor(Date.parse(pass.issuedAt) / 1000)), expiresAt: Date.parse(pass.expiresAt), receivedAt });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.copy : errorCopy(e));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const loop = async () => {
      await fetchPass();
      if (!cancelled) timer.current = setTimeout(() => void loop(), ROTATION_MS);
    };
    void loop();
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      clearInterval(tick);
    };
  }, [enabled, fetchPass]);

  // A code stays usable until its expiry, so a failed refresh keeps the last one on screen until then.
  const usable = code !== null && now < code.expiresAt;
  const msLeft = code ? Math.max(0, ROTATION_MS - (now - code.receivedAt)) : ROTATION_MS;
  return { code: usable ? code : null, error, msLeft, retry: fetchPass };
}

export function JudgesDesk() {
  const eventIdText = judgesDeskEventId();
  const configured = isDeployed() && eventIdText !== null;
  const eventId = eventIdText ? BigInt(eventIdText) : null;
  const desk = useDeskPass(configured);
  const event = usePoll(configured && eventId ? `desk-event:${eventId}` : null, () => readEvent(eventId!), COUNT_POLL_MS);
  const details = usePoll(configured && eventId ? `desk-details:${eventId}` : null, () => api.event(eventId!.toString()), 60_000);
  const live = desk.code !== null;
  const wake = useWakeLock(live);
  const fullscreen = useFullscreen();

  const bar = (
    <DoorBar title="Judges' desk">
      {fullscreen.supported && configured ? (
        <Button onClick={fullscreen.toggle} className="px-3 sm:px-5">
          {fullscreen.active ? "Exit full screen" : "Full screen"}
        </Button>
      ) : null}
    </DoorBar>
  );

  const notOpen = !configured || desk.error?.code === "judges_desk_not_open";
  if (notOpen && !live) {
    return (
      <DoorFrame bar={bar}>
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <EmptyState
            as="h1"
            title="The judges' desk is not open yet"
            action={
              <Button href="/docs/check-in" trailing={<ArrowRightIcon className="size-4" />}>
                How check-in works
              </Button>
            }
          >
            It opens for demo week, 1 to 10 December, as a permanent event judges can check in to from their own phone. {HONEST_LINE}
          </EmptyState>
        </div>
      </DoorFrame>
    );
  }

  const name = details.data?.metadata.name ?? "Judges' desk";
  const status = desk.error && live ? "Could not get a new code. Trying again." : null;

  return (
    <DoorFrame bar={bar}>
      {wake === "denied" || wake === "unsupported" ? (
        <p role="status" className="mx-4 hidden rounded-doc bg-paper-deep px-4 py-3 text-base text-ink-soft sm:mx-6 sm:block">
          <span className="font-medium text-ink">This screen may go to sleep.</span> Turn off sleep in the device settings while the desk is showing.
        </p>
      ) : null}
      <div className="mx-auto grid w-full max-w-[110rem] flex-1 content-center grid-cols-1 gap-x-[5vmin] gap-y-[3vmin] px-[4vmin] py-[3vmin] landscape:grid-cols-[minmax(0,auto)_minmax(0,1fr)] landscape:grid-rows-[auto_auto]">
        <div className="flex min-w-0 flex-col gap-[1vmin] landscape:col-start-2 landscape:row-start-1 landscape:self-end">
          <p className="text-[clamp(0.875rem,1.9vmin,1.375rem)] font-medium text-ink-soft">Admit one judge</p>
          <h1 className="font-display text-[clamp(1.75rem,6vmin,5rem)] leading-[1.02] text-balance text-ink" data-testid="desk-name">
            {name}
          </h1>
          {/* A judge holding only this phone cannot scan their own screen, so on a phone the link is one tap away. */}
          {desk.code ? (
            <div className="pt-2 landscape:hidden sm:hidden">
              <Button href={desk.code.url} variant="primary" block trailing={<ArrowRightIcon className="size-4" />}>
                Only have this phone? Check in here
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mx-auto w-full max-w-[min(88vw,52vh)] landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:w-[min(48vw,72vh)] landscape:max-w-none landscape:self-center">
          {desk.code || !desk.error ? (
            <DoorCode svg={desk.code?.svg ?? null} codeKey={desk.code?.issuedAt ?? null} issuedAt={desk.code?.issuedAt ?? ""} msLeft={desk.msLeft} status={status} />
          ) : (
            <div role="alert" className="flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-doc bg-paper-deep p-[8%] text-center">
              <p className="font-display text-[clamp(1.5rem,4.4vmin,3rem)] leading-tight text-ink">{desk.error.message}</p>
              <p className="text-[clamp(1rem,2.2vmin,1.5rem)] text-ink-soft">{desk.error.action}</p>
              <Button onClick={() => void desk.retry()}>Try again</Button>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[2.5vmin] landscape:col-start-2 landscape:row-start-2 landscape:self-start landscape:border-t landscape:border-rule-soft landscape:pt-[3vmin]">
          {event.data ? <LiveCount value={event.data.checkedIn} capacity={event.data.capacity} stale={Boolean(event.error)} /> : null}
          <div className="flex flex-col gap-[1vmin]">
            <p className="max-w-[28ch] font-display text-[clamp(1.4rem,4.4vmin,3.5rem)] leading-[1.08] text-ink">
              Open your camera and point it here<span className="text-vermilion">.</span>
            </p>
            <p className="max-w-[60ch] text-[clamp(0.95rem,1.9vmin,1.4rem)] text-ink-soft" data-testid="desk-honest-line">
              {HONEST_LINE}
            </p>
          </div>
        </div>
      </div>
    </DoorFrame>
  );
}
