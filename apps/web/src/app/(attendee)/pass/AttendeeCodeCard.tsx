"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { listUpcomingEvents, type EventListItem } from "@/lib/checkin/api-passport";
import { recentEvents, type RecentEvent } from "@/lib/checkin/local-records";
import { useLocale } from "@/lib/checkin/locale";
import { attendeeCode } from "@/lib/checkin/sign";
import { ensurePass, PassUnavailableError } from "@/lib/wallet/pass";
import { Button } from "@/ui/Button";
import { Select } from "@/ui/Field";
import { formatShortDate } from "@/ui/format";
import { CloseIcon } from "@/ui/icons";
import { QrFrame } from "@/ui/QrFrame";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { Skeleton } from "@/ui/Skeleton";
import { ExpandIcon } from "../_components/icons";
import { useHydrated } from "../_components/useHydrated";

interface Choice {
  eventId: string;
  label: string;
}

/**
 * The attendee code for "door scans you" (mode 2). It needs an event id, because the pass signs
 * CheckIn(eventId, attendee). The event defaults to the newest door code this phone opened, and
 * the list adds upcoming events from the index, so someone who never scanned a door can still pick
 * the event the volunteer is checking in.
 */
export function AttendeeCodeCard() {
  const { t } = useLocale();
  const selectId = useId();
  const hydrated = useHydrated();
  const recent = useMemo<RecentEvent[]>(() => (hydrated ? recentEvents() : []), [hydrated]);
  const [upcoming, setUpcoming] = useState<EventListItem[] | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listUpcomingEvents({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      const events = result.ok ? result.data : [];
      setUpcoming(events);
    });
    return () => controller.abort();
  }, []);

  const choices = useMemo(() => {
    const seen = new Set<string>();
    const fromPhone: Choice[] = [];
    for (const e of recent) {
      seen.add(e.eventId);
      const name = e.name ?? upcoming?.find((u) => u.id === e.eventId)?.metadata.name ?? t.common.eventFallback(e.eventId);
      fromPhone.push({ eventId: e.eventId, label: name });
    }
    const fromIndex: Choice[] = (upcoming ?? [])
      .filter((e) => !seen.has(e.id))
      .map((e) => ({ eventId: e.id, label: `${e.metadata.name}, ${formatShortDate(e.startsAt)}` }));
    return { fromPhone, fromIndex };
  }, [recent, upcoming, t]);

  const all = [...choices.fromPhone, ...choices.fromIndex];
  // Until the person picks one, the newest door code this phone opened decides the event.
  const selectedId = eventId ?? all[0]?.eventId ?? null;
  const selected = all.find((c) => c.eventId === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const pass = ensurePass();
        const code = await attendeeCode(pass, BigInt(selectedId));
        const QRCode = await import("qrcode");
        const markup = await QRCode.toString(code, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#141311", light: "#00000000" } });
        if (!cancelled) {
          setSvg(markup);
          setFailed(null);
        }
      } catch (error) {
        if (!cancelled) setFailed(error instanceof PassUnavailableError ? t.errors.storage.action : t.errors.unknown.action);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, t]);

  const loading = upcoming === null && recent.length === 0;

  return (
    <Sheet as="section" aria-labelledby="door-code-title">
      <SheetSection className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="door-code-title" className="font-display text-xl text-ink">
            {t.pass.codeTitle}
          </h2>
          <p className="text-base text-ink-soft">{t.pass.codeBody}</p>
        </div>

        {loading ? (
          <Skeleton className="h-11 w-full" />
        ) : all.length === 0 ? (
          <p className="text-base text-ink-soft">{t.pass.codeNoEvents}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={selectId} className="text-sm font-medium text-ink">
              {t.pass.codeEventLabel}
            </label>
            <Select id={selectId} value={selectedId ?? ""} onChange={(e) => setEventId(e.target.value)}>
              {choices.fromPhone.length > 0 ? (
                <optgroup label={t.pass.codeRecent}>
                  {choices.fromPhone.map((c) => (
                    <option key={c.eventId} value={c.eventId}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {choices.fromIndex.length > 0 ? (
                <optgroup label={t.pass.codeUpcoming}>
                  {choices.fromIndex.map((c) => (
                    <option key={c.eventId} value={c.eventId}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </div>
        )}

        {failed ? <p className="text-base text-vermilion-ink">{failed}</p> : null}

        {selected && svg ? (
          <>
            <div className="mx-auto w-full max-w-[18rem]">
              <QrFrame label={t.pass.codeQrLabel(selected.label)} caption={t.pass.codeCaption} status={t.pass.codeStatus}>
                <span className="block size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
              </QrFrame>
            </div>
            <Button variant="quiet" block onClick={() => setFullscreen(true)} leading={<ExpandIcon className="size-4" />}>
              {t.pass.fullscreen}
            </Button>
            {fullscreen ? <FullscreenCode svg={svg} label={t.pass.codeQrLabel(selected.label)} eventName={selected.label} onClose={() => setFullscreen(false)} /> : null}
          </>
        ) : null}
      </SheetSection>
    </Sheet>
  );
}

/**
 * The code on a plain white page, as large as the screen allows, with the screen kept awake: the
 * brightest thing a web page can show a door scanner. A modal <dialog> gives Escape and a focus trap.
 */
function FullscreenCode({ svg, label, eventName, onClose }: { svg: string; label: string; eventName: string; onClose: () => void }) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request("screen")
      .then((sentinel) => {
        lock = sentinel;
      })
      .catch(() => {
        // Wake lock is a nicety; the code works without it.
      });
    return () => {
      void lock?.release().catch(() => undefined);
      dialog?.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label={label}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-[#ffffff] p-0 text-[#141311] backdrop:bg-[#ffffff]"
    >
      <div className="flex h-full flex-col items-center justify-between gap-6 px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <p className="text-center font-display text-xl">{eventName}</p>
        <div role="img" aria-label={label} className="aspect-square w-full max-w-[min(90vw,70vh)] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="inline-flex min-h-13 w-full max-w-[20rem] items-center justify-center gap-2 rounded-doc bg-[#141311] px-6 text-md font-medium text-[#ffffff]"
        >
          <CloseIcon className="size-5" />
          {t.pass.closeFullscreen}
        </button>
      </div>
    </dialog>
  );
}
