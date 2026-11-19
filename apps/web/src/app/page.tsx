import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HeroStamp } from "@/app/(public)/_components/HeroStamp";
import { LiveStrip, LiveStripSkeleton } from "@/app/(public)/_components/LiveStrip";
import { isDeployed } from "@/lib/chain/addresses";
import { activeChain, activeChainId } from "@/lib/chain/chains";
import { judgesDeskEventId, SITE } from "@/lib/copy/site";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { ArrowRightIcon, CheckIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { PageShell } from "@/ui/PageShell";
import { Guilloche } from "@/ui/patterns/guilloche";
import { Perforation } from "@/ui/Perforation";
import { SectionBoundary } from "@/ui/SectionBoundary";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { Stamp } from "@/ui/stamp/Stamp";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name}: sponsors pay only for people who actually show up` },
  description: SITE.description,
};

const steps = [
  {
    role: "Sponsor",
    title: "Locks the budget",
    body: "A sponsor puts QIE or QUSDC into the campaign vault and sets the price of one verified person, the split between organizer and attendee, and the proof the door must show. Nothing is spent yet.",
    code: "CampaignVault.createCampaign",
  },
  {
    role: "Organizer",
    title: "Runs the door",
    body: "The organizer creates the event on chain and authorizes a short-lived door key. The door screen shows a code that is signed again every 15 seconds, so a photo of an old code is worthless.",
    code: "ShowmarkRegistry.authorizeDoorKey",
  },
  {
    role: "Attendee",
    title: "Checks in and gets stamped",
    body: "Scan the door code with a phone camera. The phone signs with a pass key it made for you, our relayer pays the gas, and a stamp lands in your passport in seconds. No wallet and no QIE needed to start.",
    code: "ShowmarkRegistry.checkIn",
  },
  {
    role: "Escrow",
    title: "Settles per person",
    body: "Right behind the check-in, the vault pays for that one person: the attendee's share and the organizer's share. When the campaign ends, everything not earned goes back to the sponsor.",
    code: "CampaignVault.settle",
  },
] as const;

const integrations = [
  {
    name: "QIE Wallet",
    job: "The wallet organizers and sponsors sign in with, and the one attendees link when they cash out. We find it by its EIP-6963 id instead of trusting whatever claims to be MetaMask.",
    where: "src/lib/wallet",
  },
  {
    name: "QIE ID names",
    job: "Shown wherever an address would be. A sponsor can also require one, so a campaign pays only people whose linked wallet holds a .qie name.",
    where: "CampaignVault.settle",
  },
  {
    name: "QIE and QUSDC",
    job: "Campaigns hold the native coin or QUSDC, the chain's dollar stablecoin. Rewards are pull payments, so one broken receiver never blocks anyone else.",
    where: "CampaignVault.withdraw",
  },
  {
    name: "QIE/USD oracle",
    job: "A sponsor can price a person in dollars and pay in QIE at the rate when the person checks in. If the price is stale, payment waits instead of going out at the wrong rate.",
    where: "CampaignVault.quote",
  },
  {
    name: "QIEDEX",
    job: "Fund a campaign from any listed token by swapping into QUSDC through the QIEDEX router, and swap rewards inside the app.",
    where: "src/app/api/dex",
  },
  {
    name: "Safe",
    job: "Every contract is owned by a Safe multisig on safe.qie.digital, and a sponsor's own Safe treasury can fund campaigns directly.",
    where: "safe.qie.digital",
  },
] as const;

const enforced = [
  "One presence per person per event. A second check-in is refused, never paid twice.",
  "A check-in never depends on the vault. Recording presence and moving money are separate transactions, so a broken campaign cannot stop a door.",
  "Only a door key the organizer authorized, inside its time window, can vouch for a check-in.",
  "A sponsor can always take back unspent funds after a campaign ends, even when the protocol is paused.",
  "The protocol fee is capped at 5% in the contract, and there are no proxies, so the rules cannot be swapped later.",
] as const;

const plainly = [
  "A rotating door code proves the check-in is fresh, not that a body was in the room. Someone could stream the screen to a friend outside. Campaigns that need more can require door scans you, where staff scan each attendee's phone.",
  "Free QIE ID names are a weak filter on their own. Presence at a real door is the main defense, backed by the organizer's bond.",
  "Disputes are decided by the protocol Safe in this version. That is centralized, and the docs say so.",
  "On the traction page, pools the team funded are counted apart from outside sponsors.",
] as const;

function SectionHeading({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h2 id={id} className="font-display text-2xl text-ink sm:text-3xl">
        {title}
      </h2>
      {children ? <p className="text-md text-ink-soft">{children}</p> : null}
    </div>
  );
}

function Hero() {
  return (
    <Container className="grid items-center gap-14 pt-12 pb-16 sm:pt-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16 lg:pt-24 lg:pb-24">
      <div className="flex flex-col gap-7">
        <h1 className="max-w-[13ch] font-display text-[clamp(3rem,7.4vw,5.5rem)] leading-[0.95] tracking-[-0.02em] text-ink">
          Sponsors pay only for people who actually show up.
        </h1>
        <p className="max-w-[36rem] text-md text-ink-soft sm:text-lg sm:leading-[1.45]">
          Showmark holds a sponsor&apos;s budget in escrow on QIE. When someone checks in at the door with their phone,
          they get a stamp in their passport and the money for that one person moves on chain, split between the
          organizer and the attendee.
        </p>
        <div className="flex flex-col gap-3 pt-1 sm:flex-row">
          <Button href="#judges-desk" variant="primary" size="lg" trailing={<ArrowRightIcon className="size-5" />}>
            Check in at the judges&apos; desk
          </Button>
          <Button href="/traction" variant="quiet" size="lg">
            See the live numbers
          </Button>
        </div>
      </div>

      <figure className="mx-auto w-full max-w-[27rem] lg:mr-0">
        <Sheet edge="stub-bottom" aria-label="Specimen check-in receipt">
          <Guilloche seed="showmark-specimen" variant="band" className="h-10 w-full opacity-75" detail={140} />
          <SheetSection className="flex flex-col gap-1 pb-4 sm:pb-5">
            <div className="flex items-baseline justify-between gap-4 text-sm text-ink-soft">
              <span>Check-in receipt</span>
              <span className="text-vermilion-ink">Specimen</span>
            </div>
            <p className="font-display text-xl text-ink">Campus builders meetup</p>
            <p className="text-sm text-ink-soft">Bengaluru, rotating door code</p>
          </SheetSection>
          <Perforation />
          <SheetSection className="grid grid-cols-[auto_1fr] items-center gap-5 pt-4 pb-8 sm:gap-6 sm:pb-9">
            <HeroStamp
              stamp={{
                eventId: "1",
                eventName: "Campus builders meetup",
                city: "Bengaluru",
                at: "2026-11-27T13:12:00.000Z",
                mode: 1,
                ink: "vermilion",
                shape: "round",
                holder: "specimen",
              }}
            />
            <Ledger label="Where one person's 2 QUSDC goes, in QUSDC" className="text-sm">
              <LedgerRow label="To you" value="1.20" className="py-1.5" />
              <LedgerRow label="Organizer" value="0.76" className="py-1.5" />
              <LedgerRow label="Fee" value="0.04" className="py-1.5" />
              <LedgerRow label="Per person" value="2.00" total className="py-1.5" />
            </Ledger>
          </SheetSection>
        </Sheet>
        <figcaption className="mt-4 text-sm text-ink-faint">
          A specimen, not real data. Sponsor sets 2 QUSDC per person, 60% to the attendee, 2% fee.
        </figcaption>
      </figure>
    </Container>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="scroll-mt-24 py-16 sm:py-20">
      <Container className="flex flex-col gap-12">
        <SectionHeading id="how-it-works" title="Four steps, and each one is a transaction you can open">
          Every claim a sponsor used to take on trust, like headcount and real humans, becomes a record on the QIE
          explorer.
        </SectionHeading>
        <Sheet as="div">
          <ol className="flex flex-col lg:flex-row">
            {steps.map((step, index) => (
              <li key={step.role} className="flex flex-col lg:flex-1 lg:flex-row">
                {index > 0 ? (
                  <>
                    <Perforation className="lg:hidden" />
                    <Perforation orientation="vertical" className="max-lg:hidden" />
                  </>
                ) : null}
                <div className="flex flex-1 flex-col gap-3 px-5 py-6 sm:px-8 sm:py-8 lg:px-6">
                  <div className="flex items-baseline gap-3">
                    <span className="font-display text-3xl leading-none text-vermilion" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-ink-soft">{step.role}</span>
                  </div>
                  <h3 className="text-lg font-medium text-ink">
                    <span className="sr-only">Step {index + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="text-base text-ink-soft">{step.body}</p>
                  <p className="mt-auto pt-3 font-mono text-xs text-ink-faint">{step.code}</p>
                </div>
              </li>
            ))}
          </ol>
        </Sheet>
      </Container>
    </section>
  );
}

function JudgesDesk() {
  const eventId = judgesDeskEventId();
  const live = isDeployed() && eventId !== null;
  return (
    <section aria-labelledby="judges-desk" className="scroll-mt-24 py-16 sm:py-20">
      <Container>
        <Sheet as="div">
          <div className="flex flex-col lg:flex-row">
            <div className="flex flex-1 flex-col gap-6 px-5 py-8 sm:px-10 sm:py-12">
              <p className="text-sm font-medium text-ink-soft">Admit one judge</p>
              <h2 id="judges-desk" className="font-display text-3xl text-ink sm:text-4xl">
                The judges&apos; desk
              </h2>
              <p className="max-w-[34rem] text-md text-ink-soft">
                A permanent event on {activeChain.name} with a small {activeChainId === 1990 ? "real" : "test"} reward.
                Open it on your own phone, scan the door code on the screen, and you will hold a stamp and a payout in
                under a minute, without a wallet or any gas.
              </p>
              <ol className="flex flex-col gap-2 text-base text-ink">
                {["Open the desk on your phone", "Scan the door code on the screen", "Watch your stamp land, then open it on the explorer"].map(
                  (line, index) => (
                    <li key={line} className="flex gap-3">
                      <span className="w-4 shrink-0 font-mono text-sm leading-[1.6rem] text-ink-faint">{index + 1}</span>
                      {line}
                    </li>
                  ),
                )}
              </ol>
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
                {live ? (
                  <Button href={`/e/${eventId}`} variant="primary" size="lg" trailing={<ArrowRightIcon className="size-5" />}>
                    Open the judges&apos; desk
                  </Button>
                ) : (
                  <p className="max-w-md text-base text-ink-soft">
                    The desk opens here as soon as the contracts are live on {activeChain.name}. Until then, read how a
                    check-in works.
                  </p>
                )}
                <Button href="/docs/check-in" variant="quiet" size="lg">
                  How check-in works
                </Button>
              </div>
            </div>
            <Perforation orientation="vertical" className="max-lg:hidden" />
            <Perforation className="lg:hidden" />
            <div className="relative grid min-h-80 place-items-center overflow-hidden px-8 py-12 lg:w-[24rem]">
              <Guilloche
                seed="judges-desk"
                className="pointer-events-none absolute top-1/2 left-1/2 size-[26rem] -translate-x-1/2 -translate-y-1/2 opacity-30"
                detail={180}
              />
              <Stamp
                eventId={eventId ?? "judges-desk"}
                serial={eventId}
                eventName="Judges' desk"
                city="QIE Hackathon 3.0"
                at="2026-12-01T06:30:00.000Z"
                mode={1}
                ink="vermilion"
                shape="oval"
                holder="judges"
                className="relative w-56"
              />
            </div>
          </div>
        </Sheet>
      </Container>
    </section>
  );
}

function Integrations() {
  return (
    <section aria-labelledby="integrations" className="py-16 sm:py-20">
      <Container className="flex flex-col gap-12">
        <SectionHeading id="integrations" title="Built on QIE, with each part doing a job">
          Six pieces of the QIE ecosystem, each one there because the product needs it.
        </SectionHeading>
        <dl className="grid border-t border-ink md:grid-cols-2 md:gap-x-12">
          {integrations.map((item) => (
            <div key={item.name} className="flex flex-col gap-2 border-b border-rule-soft py-6 sm:py-7">
              <dt className="font-display text-xl text-ink">{item.name}</dt>
              <dd className="text-base text-ink-soft">{item.job}</dd>
              <dd className="font-mono text-xs text-ink-faint">{item.where}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}

function Honesty() {
  return (
    <section aria-labelledby="honesty" className="py-16 sm:py-20">
      <Container className="flex flex-col gap-12">
        <SectionHeading id="honesty" title="What the chain enforces, and what it cannot">
          Sponsors are trusting us with money, so here is exactly where the guarantees stop.
        </SectionHeading>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-5">
            <h3 className="text-lg font-medium text-ink">Enforced by the contracts</h3>
            <ul className="flex flex-col gap-4">
              {enforced.map((line) => (
                <li key={line} className="flex gap-3 text-base text-ink-soft">
                  <CheckIcon className="mt-0.5 size-5 shrink-0 text-ledger-green" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-5">
            <h3 className="text-lg font-medium text-ink">Said plainly</h3>
            <ul className="flex flex-col gap-4">
              {plainly.map((line) => (
                <li key={line} className="flex gap-3 text-base text-ink-soft">
                  <span aria-hidden="true" className="mt-[0.7em] h-px w-4 shrink-0 bg-ink-soft" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div>
          <Button href="/docs/security" variant="secondary" trailing={<ArrowRightIcon className="size-4" />}>
            Read the security model
          </Button>
        </div>
      </Container>
    </section>
  );
}

export default function Home() {
  return (
    <PageShell current="home">
      <Hero />

      <section aria-labelledby="live-numbers">
        <Container>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 id="live-numbers" className="text-base font-medium text-ink">
              Read from the chain, not from us
            </h2>
            <Link href="/traction" className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink">
              Full traction ledger
            </Link>
          </div>
          <Sheet as="div">
            <SectionBoundary title="The live numbers did not load">
              <Suspense fallback={<LiveStripSkeleton />}>
                <LiveStrip />
              </Suspense>
            </SectionBoundary>
          </Sheet>
        </Container>
      </section>

      <HowItWorks />
      <JudgesDesk />
      <Integrations />
      <Honesty />
    </PageShell>
  );
}
