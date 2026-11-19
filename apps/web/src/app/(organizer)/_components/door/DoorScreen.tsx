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
    if (!enabled) {
      setIdle(false);
      return;
    }
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
    };
  }, [enabled]);
  return idle;
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
          <Button href={`/door/${setup.eventId}/scan`}>Scan attendee codes</Button>
          {fullscreen.supported ? <Button onClick={fullscreen.toggle}>{fullscreen.active ? "Exit full screen" : "Full screen"}</Button> : null}
          <Button onClick={() => setSettingsOpen(true)}>Settings</Button>
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
          "mx-auto grid w-full max-w-[110rem] flex-1 items-center gap-[4vmin] px-[4vmin] py-[3vmin]",
          // Portrait (tablet on a stand): name, code, count stacked. Landscape (laptop, projector): code beside the count.
          "grid-cols-1 landscape:grid-cols-[minmax(0,auto)_minmax(0,1fr)]",
        )}
      >
        <div className="order-2 mx-auto w-full max-w-[min(92vw,62vh)] landscape:order-1 landscape:max-w-[min(48vw,78vh)]">
          {checkIn === "open" ? (
            <RotatingCode doorKey={doorKey} eventId={eventId} registry={addresses.registry} clock={setup.clock.clock} />
          ) : (
            <WindowNotice state={checkIn} startsAt={event.startsAt} endsAt={event.endsAt} eventId={eventId} />
          )}
        </div>

        <div className="order-1 flex min-w-0 flex-col gap-[3vmin] landscape:order-2">
          <div className="flex flex-col gap-[1vmin]">
            <h1 className="font-display text-[clamp(2rem,6vmin,5rem)] leading-[1.02] text-balance text-ink" data-testid="door-event-name">
              {name}
            </h1>
            <p className="text-[clamp(0.95rem,2vmin,1.5rem)] text-ink-soft">
              {place ? `${place}. ` : ""}
              {formatEventWindow(new Date(Number(event.startsAt) * 1000).toISOString(), new Date(Number(event.endsAt) * 1000).toISOString())}
            </p>
          </div>
          <div className="h-px w-full bg-rule-soft" aria-hidden="true" />
          <LiveCount value={event.checkedIn} capacity={event.capacity} stale={setup.countStale} />
          {checkIn === "open" ? (
            <p className="max-w-[28ch] font-display text-[clamp(1.5rem,4.4vmin,3.5rem)] leading-[1.08] text-ink">
              Open your camera and point it here<span className="text-vermilion">.</span>
            </p>
          ) : null}
          {checkIn === "open" ? (
            <p className="text-[clamp(0.95rem,1.9vmin,1.4rem)] text-ink-soft">No app, no wallet and nothing to pay. Tap the link, then tap Check in.</p>
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
