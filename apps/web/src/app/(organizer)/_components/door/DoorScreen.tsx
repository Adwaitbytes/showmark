"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { addresses } from "@/lib/chain/addresses";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { formatEventWindow } from "@/ui/format";
import { DoorBar, DoorFrame, DoorSetupView, DoorSignals, DoorWarnings, WindowNotice } from "./DoorChrome";
import { DoorSettings } from "./DoorSettings";
import { LiveCount } from "./LiveCount";
import { RotatingCode } from "./RotatingCode";
import { useDoorSetup, useFullscreen, useWakeLock } from "./use-door";

const IDLE_HIDE_MS = 4_000;

/** Hides the controls in full screen after a few seconds without the mouse, so the projector shows only the door. */
function useIdle(enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let timer = setTimeout(() => setIdle(true), IDLE_HIDE_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_HIDE_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    window.addEventListener("pointerdown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("pointerdown", wake);
      setIdle(false);
    };
  }, [enabled]);
  return enabled && idle;
}

export function DoorScreen() {
  const params = useParams<{ eventId: string }>();
  const setup = useDoorSetup(params.eventId);
  const ready = setup.phase.kind === "ready";
  const wake = useWakeLock(ready);
  const fullscreen = useFullscreen();
  const idle = useIdle(fullscreen.active);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const name = setup.details?.metadata.name ?? (setup.eventId ? `Event ${setup.eventId}` : "Door");
  const place = setup.details ? [setup.details.metadata.venue, setup.details.metadata.city].filter(Boolean).join(", ") : null;

  const bar = (
    <DoorBar title="Door screen" hidden={idle}>
      {setup.phase.kind !== "not-deployed" && setup.phase.kind !== "invalid-id" ? <DoorSignals setup={setup} wake={ready ? wake : undefined} /> : null}
      {ready && setup.eventId !== null ? (
        <>
          <Button href={`/door/${setup.eventId}/scan`} className="px-3 sm:px-5">
            <span className="sm:hidden">Scan codes</span>
            <span className="hidden sm:inline">Scan attendee codes</span>
          </Button>
          {fullscreen.supported ? (
            <Button onClick={fullscreen.toggle} className="px-3 sm:px-5">
              {fullscreen.active ? "Exit full screen" : "Full screen"}
            </Button>
          ) : null}
          <Button onClick={() => setSettingsOpen(true)} className="px-3 sm:px-5">
            Settings
          </Button>
        </>
      ) : null}
    </DoorBar>
  );

  if (!ready || !setup.event || !setup.doorKey || setup.eventId === null || setup.phase.kind !== "ready") {
    return (
      <DoorFrame bar={bar}>
        <DoorSetupView setup={setup} />
      </DoorFrame>
    );
  }

  const { event, doorKey, eventId } = setup;
  const checkIn = setup.phase.window;

  return (
    <DoorFrame bar={bar} className={cn(idle && "cursor-none")}>
      <DoorWarnings setup={setup} wake={wake} />
      <div
        className={cn(
          "mx-auto grid w-full max-w-[110rem] flex-1 content-center gap-x-[5vmin] gap-y-[3vmin] px-[4vmin] py-[3vmin]",
          // Portrait (a tablet or phone on a stand): name, code, then the count. Landscape (laptop, projector): the code
          // on the left, the name above the count on the right.
          "grid-cols-1 landscape:grid-cols-[minmax(0,auto)_minmax(0,1fr)] landscape:grid-rows-[auto_auto]",
        )}
      >
        <div className="flex min-w-0 flex-col gap-[1vmin] landscape:col-start-2 landscape:row-start-1 landscape:self-end">
          <h1 className="font-display text-[clamp(1.75rem,6vmin,5rem)] leading-[1.02] text-balance text-ink" data-testid="door-event-name">
            {name}
          </h1>
          <p className="text-[clamp(0.95rem,2vmin,1.5rem)] text-ink-soft">
            {place ? `${place}. ` : ""}
            {formatEventWindow(new Date(Number(event.startsAt) * 1000).toISOString(), new Date(Number(event.endsAt) * 1000).toISOString())}
          </p>
        </div>

        <div className="mx-auto w-full max-w-[min(88vw,52vh)] landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:max-w-[min(48vw,80vh)] landscape:self-center">
          {checkIn === "open" ? (
            <RotatingCode doorKey={doorKey} eventId={eventId} registry={addresses.registry} clock={setup.clock.clock} />
          ) : (
            <WindowNotice state={checkIn} startsAt={event.startsAt} endsAt={event.endsAt} eventId={eventId} />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[2.5vmin] landscape:col-start-2 landscape:row-start-2 landscape:self-start landscape:border-t landscape:border-rule-soft landscape:pt-[3vmin]">
          <LiveCount value={event.checkedIn} capacity={event.capacity} stale={setup.countStale} />
          {checkIn === "open" ? (
            <div className="flex flex-col gap-[1vmin]">
              <p className="max-w-[28ch] font-display text-[clamp(1.4rem,4.4vmin,3.5rem)] leading-[1.08] text-ink">
                Open your camera and point it here<span className="text-vermilion">.</span>
              </p>
              <p className="text-[clamp(0.95rem,1.9vmin,1.4rem)] text-ink-soft">No app, no wallet and nothing to pay. Tap the link, then tap Check in.</p>
            </div>
          ) : null}
        </div>
      </div>

      <DoorSettings
        eventId={eventId}
        organizer={event.organizer}
        doorKey={doorKey.address}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onReleased={() => {
          setSettingsOpen(false);
          setup.release();
        }}
      />
    </DoorFrame>
  );
}
