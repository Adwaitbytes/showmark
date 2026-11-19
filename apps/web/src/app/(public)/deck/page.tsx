import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { activeChain } from "@/lib/chain/chains";
import { judgesDeskEventId, SITE } from "@/lib/copy/site";
import { getTraction } from "@/server/queries";
import { cn } from "@/ui/cn";
import { CheckIcon } from "@/ui/icons";
import { basisPointsToPercent, formatCount, formatDate, formatPercent, formatTime, formatTokenAmount, formatUsd, plural } from "@/ui/format";
import { Guilloche } from "@/ui/patterns/guilloche";
import { Skeleton } from "@/ui/Skeleton";
import { RubberMark } from "@/ui/stamp/RubberMark";
import { Stamp } from "@/ui/stamp/Stamp";
import { Wordmark } from "@/ui/Wordmark";
import { load } from "../_components/load";
import { deskEvent, protocolFeeBps } from "./data";
import { DeckController } from "./DeckController";
import { LiveDesk } from "./LiveDesk";

export const metadata: Metadata = {
  title: "Team presentation",
  description: "Showmark in ten slides, with the live judges' desk and traction read from the chain.",
  robots: { index: false, follow: false },
};

const TOTAL = 10;

/* Sizes are tied to the viewport so a slide reads the same on a 1920 by 1080 projector and a 1440 laptop. */
const h1 = "font-display text-[clamp(2.5rem,5.4vw,6.75rem)] leading-[0.98] tracking-[-0.015em] text-ink text-balance";
const body = "text-[clamp(1.125rem,1.55vw,2rem)] leading-[1.45] text-ink-soft";
const small = "text-[clamp(0.95rem,1.1vw,1.4rem)] text-ink-soft";

/** A ratio as a percent that never rounds a real non-zero share down to "0%". */
function share(ratio: number): string {
  if (ratio > 0 && ratio < 0.001) return "<0.1%";
  return formatPercent(ratio, ratio < 0.1 ? 1 : 0);
}

/** A value the team still has to supply. Shown on purpose so nobody presents a guess. */
function Fill({ children }: { children: string }) {
  return (
    <span className="inline-block rounded-doc border border-dashed border-rule bg-paper-deep px-[0.4em] font-mono text-[0.8em] text-ink-soft">
      [[FILL: {children}]]
    </span>
  );
}

function Slide({
  n,
  label,
  notes,
  children,
  className,
}: {
  n: number;
  label: string;
  notes: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      data-slide={n}
      id={`slide-${n}`}
      aria-label={`Slide ${n} of ${TOTAL}: ${label}`}
      className="relative flex min-h-dvh flex-col overflow-hidden bg-paper grain lg:landscape:h-dvh lg:landscape:snap-start"
    >
      <div className={cn("flex flex-1 flex-col justify-center px-[6vw] pt-[8vh] pb-[14vh]", className)}>{children}</div>
      <aside className="absolute inset-x-[4vw] bottom-[11vh] z-10 hidden max-h-[38vh] overflow-y-auto rounded-doc bg-ink px-6 py-5 text-[clamp(1rem,1.2vw,1.5rem)] leading-relaxed text-paper shadow-lift group-data-[notes=on]/deck:block">
        <p className="mb-2 text-sm font-medium opacity-70">Speaker notes</p>
        {notes}
      </aside>
      <footer className="absolute inset-x-0 bottom-0">
        <div className="perf-x mx-0 h-2 opacity-90" aria-hidden="true" />
        <div className="flex items-center justify-between px-[6vw] py-[2.4vh]">
          <span className="text-[clamp(1.1rem,1.5vw,2rem)]">
            <Wordmark />
          </span>
          <span className="font-mono text-[clamp(0.9rem,1vw,1.3rem)] text-ink-soft">
            {String(n).padStart(2, "0")} / {TOTAL}
          </span>
        </div>
      </footer>
    </section>
  );
}

function ProblemSlide() {
  return (
    <Slide
      n={1}
      label="Problem"
      notes={
        <p>
          We run campus sessions and city meetups, and every sponsor conversation ends the same way. They ask how many
          people came, we give them a number, and they have to take our word for it. Next time they fund less, because
          they cannot tell the good organizers from the ones who round up.{" "}
          <Fill>one real, specific story from our own events, told with the sponsor&apos;s permission or anonymized</Fill>
        </p>
      }
      className="grid grid-cols-1 items-center gap-[6vh] lg:landscape:grid-cols-[1.25fr_1fr] lg:landscape:gap-[6vw]"
    >
      <div className="flex flex-col gap-[4vh]">
        <h1 className={h1}>Sponsors pay for headcounts nobody can check</h1>
        <div className={cn(body, "flex max-w-[44ch] flex-col gap-[2vh]")}>
          <p>A sponsor funds an event and gets back a number, a few photos and a thank-you slide.</p>
          <p>Nobody can tell how many of those people were really there, so sponsors guess and organizers inflate.</p>
        </div>
      </div>
      <figure aria-label="An attendance sheet whose headcount is struck out" className="mx-auto w-full max-w-[34rem]">
        <svg viewBox="0 0 400 300" className="h-auto w-full text-ink" fill="none" stroke="currentColor" aria-hidden="true">
          <rect x="20" y="16" width="360" height="268" rx="3" strokeWidth="2" />
          <text x="44" y="56" fill="currentColor" stroke="none" fontSize="18" style={{ fontFamily: "var(--font-instrument-serif), Georgia, serif" }}>
            Attendance
          </text>
          {Array.from({ length: 7 }, (_, i) => (
            <line key={i} x1="44" x2="356" y1={84 + i * 24} y2={84 + i * 24} strokeWidth="1" strokeOpacity="0.35" />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <path key={i} d={`M52 ${78 + i * 24} q 30 -10 60 0 t 60 0`} strokeWidth="1.4" strokeOpacity="0.55" />
          ))}
          <text x="230" y="266" fill="currentColor" stroke="none" fontSize="40" style={{ fontFamily: "var(--font-instrument-serif), Georgia, serif" }}>
            150
          </text>
          <line x1="214" y1="258" x2="336" y2="236" stroke="var(--vermilion)" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </figure>
    </Slide>
  );
}

function PrimitiveSlide() {
  const steps = [
    { title: "Escrow", note: "The sponsor's budget sits in a contract" },
    { title: "Presence", note: "A person is verified at a real door" },
    { title: "Split and refund", note: "Organizer and attendee paid, the rest returned" },
  ];
  return (
    <Slide
      n={2}
      label="The primitive"
      notes={
        <p>
          Showmark is presence-conditional payment. The sponsor&apos;s money sits in a contract, and the only thing that
          releases it is a person being verified at a real door at a real time. The attendee gets a share, the organizer
          gets a share, and the sponsor gets back every unit nobody earned. Attendance badges exist and quest platforms
          exist, but escrowed sponsorship that settles per verified person is new.
        </p>
      }
      className="gap-[7vh]"
    >
      <h1 className={cn(h1, "max-w-[18ch]")}>Money that moves only when a person is at the door</h1>
      <ol className="grid grid-cols-1 gap-[3vh] lg:landscape:grid-cols-3 lg:landscape:gap-[3vw]">
        {steps.map((step, i) => (
          <li key={step.title} className="relative flex flex-col gap-[1.5vh] border-t-2 border-ink pt-[2.5vh]">
            <span className="font-mono text-[clamp(0.9rem,1vw,1.3rem)] text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
            <span className="font-display text-[clamp(1.75rem,2.8vw,3.5rem)] leading-none text-ink">{step.title}</span>
            <span className={small}>{step.note}</span>
            {i === 1 ? (
              <span className="pointer-events-none absolute top-[4vh] right-0 w-[clamp(6rem,8.5vw,10rem)] max-lg:hidden">
                <Stamp
                  eventId="presence"
                  eventName="Verified presence"
                  city="QIE"
                  at="2026-12-01T06:30:00.000Z"
                  mode={2}
                  ink="vermilion"
                  shape="round"
                  serial={null}
                  className="w-full"
                />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </Slide>
  );
}

async function DeskFacts() {
  await connection();
  const event = await deskEvent();
  const id = judgesDeskEventId();
  const campaign = event?.campaigns[0];
  return (
    <ul className={cn(small, "flex flex-col gap-[1.4vh]")}>
      <li>
        {event ? event.metadata.name : "Judges' desk"}, event{" "}
        <span className="font-mono text-ink">#{id ?? "not set"}</span> on {activeChain.name}.
      </li>
      {campaign ? (
        <li>
          Reward per check-in:{" "}
          <span className="font-mono text-ink">
            {formatTokenAmount(campaign.attendeeAmount, campaign.tokenSymbol)} {campaign.tokenSymbol}
          </span>
          , from a team-funded pool.
        </li>
      ) : (
        <li>The reward comes from a pool the team funded.</li>
      )}
    </ul>
  );
}

function DemoSlide() {
  const id = judgesDeskEventId();
  return (
    <Slide
      n={3}
      label="Live demo"
      notes={
        <p>
          This code is live. It is the real door code for our judges&apos; desk event, and it signs itself again every
          fifteen seconds. Scan it with your phone camera, no app and no wallet needed. [pause while judges scan] You can
          watch the count go up. Each of those is a transaction you can open on the explorer. One honest note: if you are
          scanning this through a video call, you are doing exactly what our weaker proof mode cannot stop, which is
          someone relaying the door screen. That is why sponsors can require door scans you.
        </p>
      }
      className="grid grid-cols-1 items-center gap-[5vh] lg:landscape:grid-cols-[1fr_1.15fr] lg:landscape:gap-[5vw]"
    >
      <div className="flex flex-col gap-[4vh]">
        <h1 className={h1}>Check in now, from your own phone</h1>
        <p className={body}>Point your camera at the code, tap once, and the stamp lands in a few seconds.</p>
        <Suspense fallback={<Skeleton className="h-16 w-full max-w-md" />}>
          <DeskFacts />
        </Suspense>
      </div>
      <div className="flex justify-center">
        {id ? (
          <LiveDesk eventId={id} />
        ) : (
          <p className={cn(body, "max-w-md text-center")}>The judges&apos; desk is not set up on this network yet.</p>
        )}
      </div>
    </Slide>
  );
}

function HowSlide() {
  const box = "rounded-doc bg-sheet px-[1.2vw] py-[1.4vh] shadow-sheet text-center";
  const label = "font-display text-[clamp(1.2rem,1.8vw,2.3rem)] leading-tight text-ink";
  const code = "mt-1 block font-mono text-[clamp(0.75rem,0.85vw,1.1rem)] text-ink-faint";
  const arrow = "font-mono text-[clamp(1rem,1.6vw,2rem)] text-ink-faint";
  return (
    <Slide
      n={4}
      label="How it works"
      notes={
        <p>
          Two keys sign every check-in. The door key lives only in the door screen&apos;s browser and is authorized on
          chain by the organizer for that one event. The attendee&apos;s pass key lives on their phone and never needs
          gas. The registry checks both, checks that the door pass is fresh against block time, and records presence at
          most once per person per event. Payment happens in the vault, in its own transaction right behind it, usually in
          the same 3.6 second block. A paused vault, an empty budget or a stale oracle can delay a payout, but it can never
          stop someone being checked in.
        </p>
      }
      className="gap-[5vh]"
    >
      <h1 className={h1}>Two signatures in, one stamp and one payout out</h1>
      <div className="grid grid-cols-1 items-center gap-[2vh] lg:landscape:grid-cols-[auto_auto_auto_auto_auto_auto_auto] lg:landscape:gap-[1.2vw]" aria-label="Check-in flow">
        <div className="flex flex-col gap-[1.5vh]">
          <div className={box}>
            <span className={label}>Door</span>
            <span className={code}>signs a pass every 15 s</span>
          </div>
          <div className={box}>
            <span className={label}>Phone</span>
            <span className={code}>signs the check-in</span>
          </div>
        </div>
        <span className={cn(arrow, "max-lg:hidden")} aria-hidden="true">→</span>
        <div className={box}>
          <span className={label}>Relayer</span>
          <span className={code}>pays the gas</span>
        </div>
        <span className={cn(arrow, "max-lg:hidden")} aria-hidden="true">→</span>
        <div className={cn(box, "shadow-[inset_0_0_0_2px_var(--vermilion)]")}>
          <span className={label}>ShowmarkRegistry</span>
          <span className={code}>checkInBatch: once per person</span>
        </div>
        <span className={cn(arrow, "max-lg:hidden")} aria-hidden="true">→</span>
        <div className="flex flex-col gap-[1.5vh]">
          <div className={box}>
            <span className={label}>PresenceStamp</span>
            <span className={code}>soulbound stamp</span>
          </div>
          <div className={box}>
            <span className={cn(label, "inline-flex items-center gap-2")}>
              CampaignVault <CheckIcon className="size-[1em] text-ledger-green" />
            </span>
            <span className={code}>settleBatch: a separate transaction</span>
          </div>
        </div>
      </div>
      <p className={cn(body, "max-w-[60ch]")}>
        A broken campaign can delay a payout, but it can never block a check-in.
      </p>
    </Slide>
  );
}

function IntegrationsSlide() {
  const rows = [
    ["QIE Wallet", "Sign in for organizers and sponsors, and where attendees withdraw"],
    ["QIE ID", "Names on passports, and an optional gate checked on chain at settlement"],
    ["QIE and QUSDC", "Escrow and payouts in native QIE or the QIE stablecoin"],
    ["Oracles", "Dollar budgets paid in QIE at the settlement-time price, with a staleness check"],
    ["QIEDEX", "Fund a campaign from a listed token through the QIEDEX router"],
    ["Safe", "Owns every contract and arbitrates organizer bonds"],
    ["Wallet MCP and ours", "Agents read verified reach next to wallet data"],
  ];
  return (
    <Slide
      n={5}
      label="QIE integrations"
      notes={
        <p>
          Every component is here because the product breaks without it. QIE ID is not a logo on the page: the vault
          reads it at settlement and refuses to pay a gated campaign if the linked wallet holds no name. The oracle is
          read on chain with a staleness limit, so a stale price waits instead of mispricing. A Safe owns every contract,
          so no single team member can pause the protocol.
        </p>
      }
      className="gap-[4vh]"
    >
      <h1 className={h1}>Built on QIE where the product needs it</h1>
      <table className="w-full max-w-[90rem] text-left">
        <caption className="sr-only">QIE components and what each does in Showmark</caption>
        <tbody>
          {rows.map(([name, job]) => (
            <tr key={name} className="border-b border-rule-soft first:border-t-2 first:border-t-ink">
              <th scope="row" className="w-[28%] py-[1.3vh] pr-[2vw] font-mono text-[clamp(0.95rem,1.25vw,1.6rem)] font-normal text-ink">
                {name}
              </th>
              <td className={cn(small, "py-[1.3vh]")}>{job}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Slide>
  );
}

async function TractionFigures() {
  await connection();
  const result = await load(getTraction);
  if (!result.ok) {
    return (
      <p className={body}>
        The live numbers could not be read just now ({result.message}). Every figure is on the traction page.
      </p>
    );
  }
  const t = result.data;
  const settled = (field: "teamFunded" | "external") =>
    t.settled
      .filter((row) => row[field] !== "0")
      .map((row) => `${formatTokenAmount(row[field], row.symbol)} ${row.symbol}`)
      .join(" and ") || "nothing yet";
  const figure = "font-mono text-[clamp(2.5rem,5vw,6.5rem)] leading-none text-ink";
  const caption = cn(small, "mt-[1vh] max-w-[26ch]");
  return (
    <div className="flex flex-col gap-[4vh]">
      <dl className="grid grid-cols-2 gap-x-[4vw] gap-y-[4vh] lg:landscape:grid-cols-4">
        <div>
          <dt className="sr-only">Verified attendees</dt>
          <dd className={figure}>{formatCount(t.verifiedAttendees)}</dd>
          <dd className={caption}>
            verified {t.verifiedAttendees === 1 ? "attendee" : "attendees"} across {plural(t.eventsWithCheckIns, "real event")}
          </dd>
        </div>
        <div>
          <dt className="sr-only">New QIE Wallet users</dt>
          <dd className={figure}>{formatCount(t.passesLinked)}</dd>
          <dd className={caption}>
            guests who linked a QIE Wallet, {share(t.conversionRate)} of attendees
          </dd>
        </div>
        <div>
          <dt className="sr-only">Repeat attendees</dt>
          <dd className={figure}>{formatCount(t.repeatAttendees)}</dd>
          <dd className={caption}>came back for a second event</dd>
        </div>
        <div>
          <dt className="sr-only">Showmark transactions</dt>
          <dd className={figure}>{formatCount(t.showmarkTransactions)}</dd>
          <dd className={caption}>
            transactions on {activeChain.name}
            {t.shareOfChainDaily ? `, ${share(t.shareOfChainDaily)} of the chain's latest full day` : ""}
          </dd>
        </div>
      </dl>
      <div className="grid grid-cols-1 gap-[2vh] border-t-2 border-ink pt-[2.5vh] lg:landscape:grid-cols-2 lg:landscape:gap-[4vw]">
        <p className={small}>
          <span className="font-medium text-ink">Team-funded:</span> {settled("teamFunded")} settled from our own pools
          {t.settledUsd.price > 0 ? `, about ${formatUsd(t.settledUsd.teamFunded)}` : ""}.
        </p>
        <p className={small}>
          <span className="font-medium text-ink">External:</span> {settled("external")} from{" "}
          {plural(t.sponsors.external, "outside sponsor")}
          {t.settledUsd.price > 0 ? `, about ${formatUsd(t.settledUsd.external)}` : ""}.
        </p>
      </div>
      <p className={cn(small, "text-ink-faint")}>
        Read from the chain on {formatDate(t.updatedAt)} at {formatTime(t.updatedAt)}. Every number is on{" "}
        <span className="text-stamp-blue">{SITE.appUrl.replace("https://", "")}/traction</span>.
      </p>
    </div>
  );
}

function TractionSlide() {
  return (
    <Slide
      n={6}
      label="Traction"
      notes={
        <p>
          Every number on this slide is read from the chain as the page loads, and you can repeat each query on our
          traction page. We label the pools we funded ourselves separately from outside sponsors, because judges read the
          chain and we would rather tell you first.{" "}
          <Fill>one sentence on the most interesting real event so far</Fill>
        </p>
      }
      className="gap-[5vh]"
    >
      <h1 className={h1}>Real people, read straight from the chain</h1>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <TractionFigures />
      </Suspense>
    </Slide>
  );
}

async function FeeLine() {
  await connection();
  const bps = await protocolFeeBps();
  return (
    <>
      Launch fee:{" "}
      {bps === null ? <Fill>fee in basis points</Fill> : <span className="font-mono text-ink">{basisPointsToPercent(bps)}</span>}
      , read from the vault.
    </>
  );
}

function BusinessSlide() {
  const receipt: [string, string][] = [
    ["Verified presence", "1"],
    ["Attendee share", "set by sponsor"],
    ["Organizer share", "the rest"],
    ["Protocol fee", "capped at 5%"],
    ["Refunded to sponsor", "everything unearned"],
  ];
  return (
    <Slide
      n={7}
      label="Business model"
      notes={
        <p>
          Our revenue is a fee on settled sponsorship, so we only make money when a sponsor gets a real person. The cap is
          hard-coded at 5 percent and fixed per campaign when it is created, so we cannot raise it on a sponsor mid-campaign.
          We start where we have distribution, our own campus and city events, and the next step is retail: a store visit
          is the same primitive with a door at the shop entrance. <Fill>any real sponsor conversation, only if it exists</Fill>
        </p>
      }
      className="grid grid-cols-1 items-center gap-[5vh] lg:landscape:grid-cols-[1.3fr_1fr] lg:landscape:gap-[6vw]"
    >
      <div className="flex flex-col gap-[4vh]">
        <h1 className={h1}>We earn only when a real person shows up</h1>
        <ul className={cn(body, "flex flex-col gap-[1.8vh]")}>
          <li>
            A protocol fee on each settled presence, capped at 5% in the contract.{" "}
            <Suspense fallback={null}>
              <FeeLine />
            </Suspense>
          </li>
          <li>Sponsors pay per verified attendee instead of a flat fee for a guessed headcount.</li>
          <li>First market: the campus and city events we already run. Next: brand activations and store visits.</li>
        </ul>
      </div>
      <figure className="rounded-doc bg-sheet px-[2vw] py-[3vh] shadow-sheet" aria-label="One settled presence, itemized">
        <p className="mb-[1.5vh] font-display text-[clamp(1.3rem,1.8vw,2.3rem)] text-ink">One settled presence</p>
        <dl>
          {receipt.map(([term, value]) => (
            <div key={term} className="flex items-baseline gap-3 border-b border-rule-soft py-[1.1vh]">
              <dt className={cn(small, "flex flex-1 items-baseline gap-3")}>
                {term === "Protocol fee" ? <span className="size-2 shrink-0 rotate-45 bg-vermilion" aria-hidden="true" /> : null}
                {term}
              </dt>
              <dd className="font-mono text-[clamp(0.9rem,1.1vw,1.4rem)] text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </figure>
    </Slide>
  );
}

function SecuritySlide() {
  return (
    <Slide
      n={8}
      label="Security"
      notes={
        <p>
          We wrote down ten invariants before writing the contracts, for example that a sponsor can always refund after
          the campaign plus three days even when we are paused, and every one has a test. A separate reviewer that did not
          write the code tried to break them in four rounds, and every exploit is kept as a regression test. We are also
          upfront about the limits: the rotating code stops screenshots but not a live stream, bond disputes are decided by
          our Safe for now, and free names are cheap, so the real sybil defense is presence itself and the organizer&apos;s
          bond.
        </p>
      }
      className="gap-[5vh]"
    >
      <h1 className={h1}>What we protect, and what we do not</h1>
      <div className="grid grid-cols-1 gap-[4vh] lg:landscape:grid-cols-2 lg:landscape:gap-[5vw]">
        <div className="flex flex-col gap-[1.8vh]">
          <p className="font-medium text-ink text-[clamp(1.1rem,1.4vw,1.8rem)]">Enforced on chain</p>
          {[
            "Immutable contracts owned by a Safe; pausing never blocks refunds or withdrawals.",
            "Ten invariants, each with Foundry fuzz and invariant tests: 238 tests, 100% line and branch coverage.",
            "Independent review in four rounds: 1 critical and 4 medium findings, all fixed, each kept as an exploit test.",
          ].map((line) => (
            <p key={line} className={cn(small, "flex gap-3")}>
              <CheckIcon className="mt-[0.2em] size-[1.2em] shrink-0 text-ledger-green" />
              {line}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-[1.8vh] border-l-2 border-vermilion pl-[2vw]">
          <p className="font-medium text-ink text-[clamp(1.1rem,1.4vw,1.8rem)]">Known limits</p>
          {[
            "The rotating door code can be relayed by someone streaming the screen; sponsors can require door scans you.",
            "Bond disputes are decided by the protocol Safe in this version.",
            "A free QIE ID is a weak sybil filter on its own.",
          ].map((line) => (
            <p key={line} className={small}>
              {line}
            </p>
          ))}
        </div>
      </div>
    </Slide>
  );
}

function RoadmapSlide() {
  const months = ["December", "January", "February"];
  return (
    <Slide
      n={9}
      label="Roadmap"
      notes={
        <p>
          The hackathon pays half the prize after three traction milestones in 90 days, and we planned for four. Each one
          has an on-chain metric and a tile on the traction page, so you can check our progress without asking us.{" "}
          <Fill>name the two biggest events in the plan and their expected size</Fill>
        </p>
      }
      className="gap-[5vh]"
    >
      <h1 className={h1}>The next 90 days are already on the calendar</h1>
      <div className="grid grid-cols-1 gap-[4vh] lg:landscape:grid-cols-[1.2fr_1fr] lg:landscape:gap-[5vw]">
        <ul className={cn(small, "flex flex-col gap-[1.6vh]")}>
          <li>
            10 Dec to 10 Mar: <Fill>number</Fill> events across <Fill>campuses and cities</Fill>, mapped to four milestone types.
          </li>
          <li>Series and streaks for recurring meetups, so regulars are visible on chain.</li>
          <li>IPresence and the SDK, so any QIE contract can gate on real-world presence.</li>
          <li>Next: store-visit pilots, and arbitration shared by more than one party.</li>
        </ul>
        <div className="grid grid-cols-3 gap-[1.5vw]" aria-label="Three months, starting 10 December">
          {months.map((month, i) => (
            <div key={month} className="rounded-doc bg-sheet px-[1vw] py-[1.5vh] shadow-sheet">
              <p className="font-display text-[clamp(1rem,1.5vw,2rem)] text-ink">{month}</p>
              <div className="mt-[1vh] grid grid-cols-4 gap-[0.6vw]" aria-hidden="true">
                {Array.from({ length: 8 }, (_, d) => (
                  <span
                    key={d}
                    className={cn(
                      "aspect-square rounded-pill border-[1.5px] border-dashed border-rule",
                      i === 0 && d === 2 && "border-solid border-vermilion bg-vermilion/15",
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Slide>
  );
}

function TeamSlide() {
  return (
    <Slide
      n={10}
      label="Team"
      notes={
        <p>
          We are <Fill>team name</Fill>. Each of us owns one part of the system and can take any question on it right
          now. <Fill>who answers contracts, the relayer, events and traction</Fill>. Thank you. The judges&apos; desk is
          still open if you want a stamp.
        </p>
      }
      className="gap-[4vh]"
    >
      <h1 className={h1}>The people who run the doors also wrote the code</h1>
      <ul className="grid grid-cols-1 gap-[2vh] lg:landscape:grid-cols-4 lg:landscape:gap-[1.5vw]">
        {[1, 2, 3, 4].map((i) => (
          <li key={i} className="flex flex-col gap-[1.5vh] rounded-doc border border-dashed border-rule bg-sheet px-[1.2vw] py-[2vh]">
            <Guilloche seed={`team-placeholder-${i}`} className="size-[clamp(3.5rem,6vw,7rem)] opacity-60" detail={120} />
            <Fill>team member name, role</Fill>
            <span className="text-sm text-ink-faint">To be filled when the roster arrives</span>
          </li>
        ))}
      </ul>
      <p className={small}>
        Built with AI assistance, which the hackathon encourages. Every area has a named human owner who reviewed and
        merged its code. Repo <span className="font-mono text-ink">{SITE.repoUrl.replace("https://", "")}</span>, app{" "}
        <span className="font-mono text-ink">{SITE.appUrl.replace("https://", "")}</span>.
      </p>
      <div className="pointer-events-none absolute top-[7vh] right-[5vw] w-[clamp(8rem,14vw,16rem)] max-lg:hidden" aria-hidden="true">
        <RubberMark lines={["Draft", "roster pending"]} seed="deck-team" ink="ink" />
      </div>
    </Slide>
  );
}

export default function DeckPage() {
  return (
    <DeckController>
      <ProblemSlide />
      <PrimitiveSlide />
      <DemoSlide />
      <HowSlide />
      <IntegrationsSlide />
      <TractionSlide />
      <BusinessSlide />
      <SecuritySlide />
      <RoadmapSlide />
      <TeamSlide />
    </DeckController>
  );
}
