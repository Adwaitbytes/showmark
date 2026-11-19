import Link from "next/link";
import type { Passport, Stamp as StampRecord } from "@/lib/api/types";
import { PROOF_MODES } from "@/lib/copy/proof";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { BlankStampMark } from "@/ui/EmptyState";
import { formatCount, formatDate } from "@/ui/format";
import { Guilloche } from "@/ui/patterns/guilloche";
import { createRng } from "@/ui/seed";
import { Sheet } from "@/ui/Sheet";
import { Stamp } from "@/ui/stamp/Stamp";
import { stampSpec } from "@/ui/stamp/stampSvg";
import { TxLink } from "@/ui/TxLink";

const STAMPS_PER_PAGE = 4;

/** Where each of the four stamps sits on a page, before the holder's jitter is added (percent of page). */
const SLOTS = [
  { left: 7, top: 6 },
  { left: 52, top: 12 },
  { left: 9, top: 51 },
  { left: 51, top: 57 },
] as const;

function holderSeed(passport: Passport): string {
  return passport.wallet ?? passport.pass ?? passport.qieName ?? "showmark";
}

/** Machine readable zone, as on the bottom of a passport's data page. Two lines of 44 characters. */
function machineReadableZone(passport: Passport): [string, string] {
  const name = (passport.qieName ?? "HOLDER").toUpperCase().replace(/[^A-Z0-9]/g, "<");
  const line1 = `P<SHOWMARK<<${name}`.padEnd(44, "<").slice(0, 44);
  const address = (passport.pass ?? passport.wallet ?? "").replace(/^0x/i, "").toUpperCase();
  const count = String(Math.min(passport.stamps.length, 999)).padStart(3, "0");
  const line2 = `${address}<${count}`.padEnd(44, "<").slice(0, 44);
  return [line1, line2];
}

function DataField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-ink-soft">{label}</dt>
      <dd className="text-base text-ink">{children}</dd>
    </div>
  );
}

function DataPage({ passport }: { passport: Passport }) {
  const seed = holderSeed(passport);
  const cities = new Set(passport.stamps.map((s) => s.city.trim().toLowerCase()).filter(Boolean)).size;
  const first = passport.stamps.reduce<StampRecord | null>((a, s) => (!a || s.at < a.at ? s : a), null);
  const [mrz1, mrz2] = machineReadableZone(passport);

  return (
    <Sheet as="section" aria-labelledby="holder" className="overflow-hidden">
      <Guilloche seed={seed} variant="band" className="h-10 w-full" detail={160} />
      <div className="relative grid grid-cols-1 gap-8 px-5 py-7 sm:grid-cols-[auto_1fr] sm:gap-10 sm:px-9 sm:py-9">
        <Guilloche
          seed={`${seed}:watermark`}
          className="pointer-events-none absolute -right-24 -bottom-28 size-[26rem] opacity-[0.16]"
          detail={160}
        />
        <div className="relative flex flex-col items-center gap-3 sm:items-start">
          <div className="grid size-44 place-items-center rounded-doc bg-paper-deep/60 shadow-[inset_0_0_0_1px_var(--rule-soft)] sm:size-52">
            <Guilloche seed={seed} className="size-40 sm:size-48" label={`Guilloche seal generated from ${seed}`} />
          </div>
          <p className="max-w-52 text-center text-xs text-ink-faint sm:text-left">
            This seal is drawn from the holder&apos;s address. No two passports share one.
          </p>
        </div>
        <div className="relative flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-ink-soft">Showmark passport</p>
            <h1 id="holder" className="font-display text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.02] text-ink break-words">
              {passport.qieName ?? "Unnamed holder"}
            </h1>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3">
            <DataField label="Stamps">{formatCount(passport.stamps.length)}</DataField>
            <DataField label="Cities">{formatCount(cities)}</DataField>
            <DataField label="First stamp">{first ? formatDate(first.at) : "Not yet"}</DataField>
            <DataField label="QIE ID">{passport.holdsQieId ? "Held" : "None yet"}</DataField>
            <div className="col-span-2 flex flex-col gap-1.5">
              <dt className="text-xs font-medium text-ink-soft">Pass</dt>
              <dd>{passport.pass ? <AddressChip address={passport.pass} /> : <span className="text-ink-soft">No guest pass</span>}</dd>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5 lg:col-span-3">
              <dt className="text-xs font-medium text-ink-soft">Wallet</dt>
              <dd>
                {passport.wallet ? (
                  <AddressChip address={passport.wallet} name={passport.qieName} />
                ) : (
                  <span className="text-base text-ink-soft">Not linked to a QIE Wallet yet</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <div aria-hidden="true" className="border-t border-rule-soft bg-paper-deep/50 px-5 py-4 sm:px-9">
        <p className="overflow-hidden font-mono text-[0.625rem] leading-[1.8] tracking-[0.08em] whitespace-nowrap text-ink-soft min-[400px]:text-[0.7rem] sm:text-sm sm:tracking-[0.22em]">
          {mrz1}
          <br />
          {mrz2}
        </p>
      </div>
    </Sheet>
  );
}

function Punches({ current, best }: { current: number; best: number }) {
  const total = Math.max(best, current) + 1;
  return (
    <span className="flex flex-wrap gap-1.5" aria-hidden="true">
      {Array.from({ length: Math.min(total, 12) }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-4 rounded-pill",
            i < current ? "bg-ink" : "bg-paper shadow-[inset_0_1px_2px_rgb(var(--shadow-color)/0.25)]",
          )}
        />
      ))}
    </span>
  );
}

function Streaks({ streaks }: { streaks: Passport["streaks"] }) {
  if (!streaks.length) return null;
  return (
    <section aria-labelledby="streaks" className="flex flex-col gap-5">
      <h2 id="streaks" className="font-display text-2xl text-ink">
        Streaks
      </h2>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {streaks.map((streak) => (
          <li key={streak.seriesId}>
            <Sheet tone="inset" className="flex flex-col gap-3 px-5 py-5">
              <p className="font-medium text-ink">{streak.seriesName}</p>
              <Punches current={streak.current} best={streak.best} />
              <p className="text-sm text-ink-soft">
                {streak.current > 0
                  ? `${formatCount(streak.current)} in a row now. Best run ${formatCount(streak.best)}.`
                  : `Best run ${formatCount(streak.best)}. Come to the next one to start again.`}
              </p>
            </Sheet>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StampPage({
  stamps,
  pageNumber,
  holder,
  side,
}: {
  stamps: StampRecord[];
  pageNumber: number;
  holder: string;
  side: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "relative aspect-[5/6] overflow-hidden bg-sheet grain sm:aspect-[5/6.4]",
        side === "left" ? "md:rounded-l-doc" : "md:rounded-r-doc",
      )}
    >
      <Guilloche
        seed={`${holder}:page:${pageNumber}`}
        className="pointer-events-none absolute top-1/2 left-1/2 size-[92%] -translate-x-1/2 -translate-y-1/2 opacity-[0.12]"
        detail={140}
      />
      {stamps.map((stamp, index) => {
        const slot = SLOTS[index] ?? SLOTS[0];
        const jitter = createRng(`${holder}:${stamp.eventId}:place`);
        const left = slot.left + jitter.range(-3, 4);
        const top = slot.top + jitter.range(-3, 4);
        const label = stampSpec({ ...stamp, holder }).label;
        return (
          <Link
            key={`${stamp.eventId}-${stamp.tx}`}
            href={`/e/${stamp.eventId}`}
            aria-label={`${label}. Open the event`}
            className="absolute w-[40%] rounded-pill transition-transform duration-200 ease-out-quart hover:scale-[1.03] focus-visible:outline-offset-0"
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            <Stamp
              eventId={stamp.eventId}
              eventName={stamp.eventName}
              city={stamp.city}
              at={stamp.at}
              mode={stamp.mode}
              holder={holder}
              idPrefix={`p${pageNumber}-${index}`}
              className="w-full"
            />
          </Link>
        );
      })}
      {stamps.length === 0 ? (
        <div className="absolute inset-0 grid place-items-center p-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <BlankStampMark className="size-24" />
            <p className="max-w-56 text-sm text-ink-soft">The next stamp lands on this page.</p>
          </div>
        </div>
      ) : null}
      <span className={cn("absolute bottom-3 font-mono text-xs text-ink-faint", side === "left" ? "left-4" : "right-4")}>
        {pageNumber}
      </span>
    </div>
  );
}

function Booklet({ passport }: { passport: Passport }) {
  const holder = holderSeed(passport);
  const ordered = [...passport.stamps].sort((a, b) => a.at.localeCompare(b.at));
  const pages: StampRecord[][] = [];
  for (let i = 0; i < ordered.length; i += STAMPS_PER_PAGE) pages.push(ordered.slice(i, i + STAMPS_PER_PAGE));
  // Always leave room for the next stamp, and fill the spread so the book opens flat.
  if (pages.length === 0 || (pages[pages.length - 1]?.length ?? 0) === STAMPS_PER_PAGE) pages.push([]);
  if (pages.length % 2 === 1) pages.push([]);
  const spreads: [StampRecord[], StampRecord[]][] = [];
  for (let i = 0; i < pages.length; i += 2) spreads.push([pages[i] ?? [], pages[i + 1] ?? []]);

  return (
    <section aria-labelledby="stamps" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="stamps" className="font-display text-2xl text-ink">
          Stamps
        </h2>
        <p className="text-sm text-ink-soft">Oldest first. Each stamp opens its event.</p>
      </div>
      <div className="flex flex-col gap-8">
        {spreads.map(([left, right], spreadIndex) => (
          <div
            key={spreadIndex}
            className="relative grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-0 md:rounded-doc md:shadow-lift"
          >
            <div className="shadow-sheet md:shadow-none">
              <StampPage stamps={left} pageNumber={spreadIndex * 2 + 1} holder={holder} side="left" />
            </div>
            <div className="shadow-sheet md:shadow-none">
              <StampPage stamps={right} pageNumber={spreadIndex * 2 + 2} holder={holder} side="right" />
            </div>
            {/* The fold: a soft shadow where the two pages meet. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-10 -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgb(var(--shadow-color)/0.1)_45%,rgb(var(--shadow-color)/0.16)_50%,rgb(var(--shadow-color)/0.1)_55%,transparent)] md:block"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function Register({ stamps }: { stamps: StampRecord[] }) {
  if (!stamps.length) return null;
  const ordered = [...stamps].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section aria-labelledby="register" className="flex flex-col gap-5">
      <h2 id="register" className="font-display text-2xl text-ink">
        Register
      </h2>
      <ol className="border-t border-ink">
        {ordered.map((stamp) => (
          <li
            key={`${stamp.eventId}-${stamp.tx}`}
            className="grid grid-cols-1 gap-1 border-b border-rule-soft py-3.5 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6"
          >
            <Link href={`/e/${stamp.eventId}`} className="font-medium text-ink underline decoration-transparent underline-offset-4 hover:decoration-current">
              {stamp.eventName}
            </Link>
            <span className="text-sm text-ink-soft">
              {stamp.city ? `${stamp.city}, ` : ""}
              {formatDate(stamp.at)}, {PROOF_MODES[stamp.mode].name.toLowerCase()}
            </span>
            <TxLink hash={stamp.tx} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A public passport: data page, streaks, the stamp booklet and a register of every stamp. Pure. */
export function PassportView({ passport }: { passport: Passport }) {
  return (
    <div className="flex flex-col gap-12 sm:gap-14">
      <DataPage passport={passport} />
      {passport.stamps.length === 0 ? (
        <div className="flex flex-col items-start gap-4">
          <p className="max-w-prose text-md text-ink-soft">
            No stamps yet. A stamp lands here the moment this pass checks in at a Showmark event.
          </p>
          <Button href="/docs/check-in" variant="secondary">
            How check-in works
          </Button>
        </div>
      ) : null}
      <Streaks streaks={passport.streaks} />
      <Booklet passport={passport} />
      <Register stamps={passport.stamps} />
    </div>
  );
}
