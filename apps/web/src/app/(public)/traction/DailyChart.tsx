import type { Traction } from "@/lib/api/types";
import { DISPLAY_TIME_ZONE_LABEL, formatCount, formatShortDate } from "@/ui/format";

type Day = Traction["daily"][number];

/** Rounds up to 1, 2 or 5 times a power of ten so the axis reads in clean steps. */
function niceCeiling(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value) ?? 10;
  return step * power;
}

function dayLabel(date: string): string {
  return formatShortDate(`${date}T12:00:00.000Z`);
}

/**
 * Daily check-ins (stamp blue) and settlements (vermilion) as paired columns. Drawn in HTML so
 * labels stay crisp at any width. Hover shows the day's values; the table below carries every
 * number for keyboard and screen reader users.
 */
export function DailyChart({ daily }: { daily: readonly Day[] }) {
  const max = niceCeiling(Math.max(...daily.map((d) => Math.max(d.checkIns, d.settlements)), 1));
  const ticks = [max, max / 2, 0];
  const peak = daily.reduce<Day | null>((best, day) => (!best || day.checkIns > best.checkIns ? day : best), null);
  const pct = (value: number) => `${(value / max) * 100}%`;
  const first = daily[0];
  const last = daily[daily.length - 1];
  const middle = daily[Math.floor(daily.length / 2)];

  return (
    <figure className="flex flex-col gap-5">
      <figcaption className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <span className="flex flex-col gap-1">
          <span className="text-lg font-medium text-ink">Check-ins and settlements per day</span>
          <span className="text-sm text-ink-soft">Days in {DISPLAY_TIME_ZONE_LABEL}, counted from CheckedIn and Settled events on chain.</span>
        </span>
        <span className="flex gap-5 text-sm text-ink-soft" aria-hidden="true">
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-[2px] bg-chart-1" />
            Check-ins
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-[2px] bg-chart-2" />
            Settlements
          </span>
        </span>
      </figcaption>

      <div aria-hidden="true" className="relative h-60 sm:h-72">
        {ticks.map((tick) => (
          <div
            key={tick}
            className="absolute inset-x-0 flex items-center gap-3"
            style={{ bottom: pct(tick), transform: "translateY(50%)" }}
          >
            <span className="w-8 shrink-0 text-right font-mono text-xs text-ink-faint">{formatCount(tick)}</span>
            <span className={tick === 0 ? "h-px flex-1 bg-ink-soft" : "h-px flex-1 bg-rule-soft"} />
          </div>
        ))}
        <ol className="absolute inset-y-0 right-0 left-11 flex items-end gap-[3px] sm:gap-2">
          {daily.map((day) => (
            <li key={day.date} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]">
              <span
                className="w-full max-w-3 rounded-t-[3px] bg-chart-1 transition-opacity group-hover:opacity-80"
                style={{ height: day.checkIns ? pct(day.checkIns) : "0" }}
              />
              <span
                className="w-full max-w-3 rounded-t-[3px] bg-chart-2 transition-opacity group-hover:opacity-80"
                style={{ height: day.settlements ? pct(day.settlements) : "0" }}
              />
              {peak && peak.date === day.date && peak.checkIns > 0 ? (
                <span
                  className="absolute left-1/2 -translate-x-1/2 pb-1 font-mono text-xs text-ink"
                  style={{ bottom: pct(day.checkIns) }}
                >
                  {formatCount(day.checkIns)}
                </span>
              ) : null}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max -translate-x-1/2 rounded-doc bg-ink px-3 py-2 text-sm text-paper shadow-lift group-hover:block">
                <span className="block font-medium">{dayLabel(day.date)}</span>
                <span className="block">{formatCount(day.checkIns)} check-ins</span>
                <span className="block">{formatCount(day.settlements)} settlements</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {first && last ? (
        <div aria-hidden="true" className="-mt-2 ml-11 flex justify-between font-mono text-xs text-ink-faint">
          <span>{dayLabel(first.date)}</span>
          {middle && daily.length > 6 ? <span>{dayLabel(middle.date)}</span> : null}
          <span>{dayLabel(last.date)}</span>
        </div>
      ) : null}

      <details className="group/table text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-ink-soft underline decoration-rule underline-offset-4 hover:text-ink">
          Show the numbers as a table
        </summary>
        <table className="mt-3 w-full max-w-md text-left">
          <caption className="sr-only">Check-ins and settlements per day</caption>
          <thead>
            <tr className="border-b border-ink text-ink-soft">
              <th scope="col" className="py-2 font-medium">
                Day
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Check-ins
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Settlements
              </th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {daily.map((day) => (
              <tr key={day.date} className="border-b border-rule-soft">
                <th scope="row" className="py-1.5 font-sans font-normal text-ink-soft">
                  {dayLabel(day.date)}
                </th>
                <td className="py-1.5 text-right">{formatCount(day.checkIns)}</td>
                <td className="py-1.5 text-right">{formatCount(day.settlements)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
