import type { EventDetail } from "@/lib/api/types";
import { PROOF_MODES } from "@/lib/copy/proof";
import { AddressChip } from "@/ui/AddressChip";
import { Amount } from "@/ui/Amount";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { formatCount, formatDate, formatEventWindow, formatShortDate, formatTime } from "@/ui/format";
import { Guilloche } from "@/ui/patterns/guilloche";
import { Perforation } from "@/ui/Perforation";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { Stamp } from "@/ui/stamp/Stamp";
import { StatusMark, type StatusTone } from "@/ui/StatusMark";
import { TxLink } from "@/ui/TxLink";

const HOUR = 60 * 60 * 1000;

type Phase = "upcoming" | "open" | "ended";

/** Check-in is accepted from one hour before the start to one hour after the end (INTERFACES 2.3). */
function phaseOf(event: EventDetail, now: number): Phase {
  const opens = Date.parse(event.startsAt) - HOUR;
  const closes = Date.parse(event.endsAt) + HOUR;
  if (now < opens) return "upcoming";
  if (now > closes) return "ended";
  return "open";
}

const phaseMark: Record<Phase, { tone: StatusTone; label: (e: EventDetail) => string }> = {
  upcoming: { tone: "scheduled", label: (e) => `Starts ${formatShortDate(e.startsAt)}` },
  open: { tone: "live", label: () => "Check-in open" },
  ended: { tone: "ended", label: () => "Ended" },
};

function CheckInGuide({ phase }: { phase: Phase }) {
  if (phase === "ended") {
    return (
      <p className="text-base text-ink-soft">
        Check-in has closed. Everyone who was here holds a stamp, and each one is a transaction you can open below.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-ink-soft">
        {phase === "upcoming"
          ? "Check-in opens one hour before the start. At the door, open your phone camera and scan the code on the door screen."
          : "At the door, open your phone camera and scan the code on the door screen. Your stamp lands in seconds, with no wallet and no gas."}
      </p>
      <Button href="/pass" variant="secondary" block>
        Get your pass ready
      </Button>
    </div>
  );
}

/** The public event page body. Pure: pass the event and the time to judge it against. */
export function EventView({ event, now }: { event: EventDetail; now: number }) {
  const phase = phaseOf(event, now);
  const mark = phaseMark[phase];
  const { name, venue, city, description, url } = event.metadata;
  const capped = event.capacity > 0;
  const fill = capped ? Math.min(event.checkedIn / event.capacity, 1) : 0;
  const strongest = event.campaigns.some((c) => c.minProofMode === 2) ? 2 : 1;

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <Sheet as="article" aria-labelledby="event-name">
        <Guilloche seed={`event:${event.id}`} variant="band" className="h-12 w-full opacity-80" detail={160} />
        <div className="flex flex-col lg:flex-row">
          <SheetSection className="flex flex-1 flex-col gap-6 py-8 sm:py-10 lg:pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <StatusMark tone={mark.tone}>{mark.label(event)}</StatusMark>
              <span className="font-mono text-sm text-ink-faint">Event no. {event.id}</span>
            </div>
            <h1 id="event-name" className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-[1] tracking-[-0.015em] text-ink">
              {name}
            </h1>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <dt className="text-sm text-ink-soft">When</dt>
                <dd className="text-base text-ink">{formatEventWindow(event.startsAt, event.endsAt)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-sm text-ink-soft">Where</dt>
                <dd className="text-base text-ink">
                  {venue}
                  {city ? `, ${city}` : ""}
                </dd>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <dt className="text-sm text-ink-soft">Organized by</dt>
                <dd>
                  <AddressChip address={event.organizer} name={event.organizerName} />
                </dd>
              </div>
            </dl>
            {description ? <p className="max-w-prose text-md text-ink-soft">{description}</p> : null}
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="w-fit text-base text-stamp-blue underline decoration-stamp-blue/35 underline-offset-4 hover:decoration-stamp-blue"
              >
                Event website
              </a>
            ) : null}
            {event.seriesId !== "0" ? (
              <p className="text-sm text-ink-faint">
                Part {event.seriesIndex} of a series. Coming to the next one in a row builds a streak.
              </p>
            ) : null}
          </SheetSection>

          <Perforation orientation="vertical" className="max-lg:hidden" />
          <Perforation className="lg:hidden" />

          <SheetSection className="flex flex-col gap-7 py-8 sm:py-10 lg:w-[22rem]">
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink-soft">Checked in</p>
              <p className="text-ink">
                <span className="text-[3.25rem] leading-none font-medium tracking-[-0.03em]">{formatCount(event.checkedIn)}</span>
                <span className="ml-2 text-base text-ink-soft">
                  {capped ? `of ${formatCount(event.capacity)}` : "with no cap"}
                </span>
              </p>
              {capped ? (
                <div
                  className="mt-1 h-1.5 overflow-hidden rounded-pill bg-paper-deep"
                  role="meter"
                  aria-label="Capacity used"
                  aria-valuemin={0}
                  aria-valuemax={event.capacity}
                  aria-valuenow={event.checkedIn}
                >
                  <div className="h-full rounded-pill bg-ink" style={{ width: `${fill * 100}%` }} />
                </div>
              ) : null}
            </div>
            <div className="grid place-items-center py-2">
              <Stamp
                eventId={event.id}
                eventName={name}
                city={city}
                at={event.startsAt}
                mode={strongest}
                className="w-44"
              />
              <p className="mt-3 text-center text-sm text-ink-faint">The stamp everyone here gets</p>
            </div>
            <CheckInGuide phase={phase} />
          </SheetSection>
        </div>
      </Sheet>

      <section aria-labelledby="paying" className="flex flex-col gap-5">
        <h2 id="paying" className="font-display text-2xl text-ink">
          Who pays for showing up
        </h2>
        {event.campaigns.length ? (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {event.campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Sheet tone="inset" className="h-full">
                  <SheetSection className="flex h-full flex-col gap-3 py-5 sm:py-6">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="font-medium text-ink">{campaign.sponsorName}</p>
                      <span className="font-mono text-xs text-ink-faint">Campaign {campaign.id}</span>
                    </div>
                    <p className="text-base text-ink-soft">{campaign.name}</p>
                    <p className="text-lg text-ink">
                      <Amount value={campaign.attendeeAmount} symbol={campaign.tokenSymbol} />
                      <span className="ml-2 text-base text-ink-soft">to each verified attendee</span>
                    </p>
                    <p className="mt-auto text-sm text-ink-faint">
                      Needs {PROOF_MODES[campaign.minProofMode].name.toLowerCase()}
                      {campaign.requireQieId ? ", and a QIE ID on the wallet you cash out to." : "."}
                    </p>
                  </SheetSection>
                </Sheet>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-prose text-base text-ink-soft">
            No sponsor is paying for this event yet. Check-ins still earn a stamp, and a sponsor can approve the event
            into a campaign at any time.
          </p>
        )}
      </section>

      <section aria-labelledby="recent" className="flex flex-col gap-5">
        <h2 id="recent" className="font-display text-2xl text-ink">
          Recent check-ins
        </h2>
        {event.recentCheckIns.length ? (
          <ol className="border-t border-ink">
            {event.recentCheckIns.map((checkIn) => (
              <li
                key={`${checkIn.attendee}-${checkIn.tx}`}
                className="flex flex-col gap-2 border-b border-rule-soft py-3 sm:flex-row sm:items-center sm:gap-6"
              >
                <AddressChip address={checkIn.attendee} name={checkIn.name} link="passport" copy={false} />
                <span className="text-sm text-ink-soft sm:flex-1">
                  {formatDate(checkIn.at)}, {formatTime(checkIn.at)}, {PROOF_MODES[checkIn.mode].name.toLowerCase()}
                </span>
                <TxLink hash={checkIn.tx} />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No one has checked in yet" as="h3">
            {phase === "upcoming"
              ? "The first stamps land when the door opens, one hour before the start."
              : "When people scan the door code, each check-in appears here with a link to its transaction."}
          </EmptyState>
        )}
        <p className="text-sm text-ink-faint">
          Created in <TxLink hash={event.createdTx} className="text-sm" />
        </p>
      </section>
    </div>
  );
}
