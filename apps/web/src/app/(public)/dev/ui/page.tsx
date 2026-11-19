import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import type { ReactNode } from "react";
import { AddressChip } from "@/ui/AddressChip";
import { Amount } from "@/ui/Amount";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { SelectField, TextareaField, TextField } from "@/ui/Field";
import { ArrowRightIcon, RetryIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { LinkTabs } from "@/ui/LinkTabs";
import { Notice } from "@/ui/Notice";
import { PageShell } from "@/ui/PageShell";
import { Guilloche } from "@/ui/patterns/guilloche";
import { Perforation } from "@/ui/Perforation";
import { QrFrame } from "@/ui/QrFrame";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton, SkeletonStamp, SkeletonText } from "@/ui/Skeleton";
import { Stamp } from "@/ui/stamp/Stamp";
import { StatusMark } from "@/ui/StatusMark";
import { Tabs } from "@/ui/Tabs";
import { TxLink } from "@/ui/TxLink";
import { SAMPLE_PASS, SAMPLE_TX, SAMPLE_WALLET, samplePassport } from "@/ui/__fixtures__";
import { StampPressDemo } from "./StampPressDemo";

export const metadata: Metadata = {
  title: "UI gallery",
  robots: { index: false, follow: false },
};

const swatches = [
  ["paper", "Page, the desk"],
  ["sheet", "Documents on the desk"],
  ["paper-deep", "Insets, slips, skeletons"],
  ["ink", "Text, rules, primary marks"],
  ["ink-soft", "Secondary text"],
  ["ink-faint", "Tertiary text"],
  ["vermilion", "The one accent"],
  ["stamp-blue", "Secondary marks, data links"],
  ["ledger-green", "Success"],
  ["rule", "Control borders"],
] as const;

const typeScale = [
  ["5xl", "5.5rem", "font-display text-5xl"],
  ["4xl", "4rem", "font-display text-4xl"],
  ["3xl", "3rem", "font-display text-3xl"],
  ["2xl", "2.25rem", "font-display text-2xl"],
  ["xl", "1.75rem", "font-display text-xl"],
  ["lg", "1.375rem", "text-lg"],
  ["md", "1.125rem", "text-md"],
  ["base", "1rem", "text-base"],
  ["sm", "0.875rem", "text-sm"],
  ["xs", "0.75rem", "text-xs"],
] as const;

const seeds = [SAMPLE_PASS, SAMPLE_WALLET, "0x0000000000000000000000000000000000000001", "0xA8C849C243BA940102d2deB99971e4c713411926"];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-rule-soft py-12">
      <h2 id={id} className="mb-8 font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function UiGallery() {
  // A design tool, never shipped to production visitors.
  if (process.env.NODE_ENV === "production") notFound();

  const qr = await QRCode.toString("https://showmark.vercel.app/c/12.1764245000.sample", {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#141311", light: "#00000000" },
  });

  return (
    <PageShell>
      <Container className="py-12">
        <h1 className="font-display text-4xl">Showmark UI gallery</h1>
        <p className="mt-3 max-w-prose text-md text-ink-soft">
          Every primitive and state in one place, drawn from typed fixtures. Hidden in production.
        </p>

        <Section id="palette" title="Palette">
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {swatches.map(([token, use]) => (
              <li key={token} className="flex flex-col gap-2">
                <span className="h-16 rounded-doc shadow-[inset_0_0_0_1px_var(--rule-soft)]" style={{ background: `var(--${token})` }} />
                <span className="font-mono text-xs">--{token}</span>
                <span className="text-sm text-ink-soft">{use}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="type" title="Type scale">
          <ul className="flex flex-col gap-4">
            {typeScale.map(([name, size, cls]) => (
              <li key={name} className="flex items-baseline gap-6">
                <span className="w-24 shrink-0 font-mono text-xs text-ink-soft">
                  {name} {size}
                </span>
                <span className={`${cls} truncate`}>Sponsors pay for people who show up</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="buttons" title="Buttons">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary">Check in</Button>
            <Button variant="secondary">Fund a campaign</Button>
            <Button variant="quiet">See the numbers</Button>
            <Button variant="primary" size="lg" trailing={<ArrowRightIcon className="size-5" />}>
              Open the judges&apos; desk
            </Button>
            <Button variant="secondary" pending>
              Checking in
            </Button>
            <Button variant="quiet" disabled>
              Disabled
            </Button>
            <Button variant="quiet" href="https://mainnet.qie.digital" external>
              Explorer
            </Button>
          </div>
        </Section>

        <Section id="fields" title="Fields">
          <div className="grid grid-cols-1 max-w-3xl gap-6 sm:grid-cols-2">
            <TextField id="g-name" label="Event name" hint="People see this on their stamp." placeholder="Campus builders meetup" />
            <TextField
              id="g-amount"
              label="Amount per verified person"
              mono
              defaultValue="1.5"
              error="Enter an amount of at least 0.01 QUSDC."
            />
            <SelectField id="g-proof" label="Proof required" hint="Door scans you is the stronger proof.">
              <option>Rotating door code</option>
              <option>Door scans you</option>
            </SelectField>
            <TextField id="g-disabled" label="Organizer" defaultValue="campusweb3.qie" disabled />
            <TextareaField id="g-desc" label="Description" optional fieldClassName="sm:col-span-2" />
          </div>
        </Section>

        <Section id="sheets" title="Sheets, perforation and stubs">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <Sheet>
              <SheetSection>
                <p className="font-display text-xl">A document</p>
                <p className="mt-2 text-ink-soft">Raised on the desk, with grain.</p>
              </SheetSection>
              <Perforation />
              <SheetSection>
                <p className="text-sm text-ink-soft">Tear-off stub below the perforation.</p>
              </SheetSection>
            </Sheet>
            <Sheet edge="stub-bottom">
              <SheetSection>
                <p className="font-display text-xl">Ticket stub</p>
                <p className="mt-2 text-ink-soft">The bottom edge is a real cut-out.</p>
              </SheetSection>
            </Sheet>
            <Sheet tone="inset">
              <SheetSection>
                <p className="font-display text-xl">Inset slip</p>
                <p className="mt-2 text-ink-soft">For secondary panels.</p>
              </SheetSection>
            </Sheet>
          </div>
        </Section>

        <Section id="guilloche" title="Guilloche, seeded by address">
          <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {seeds.map((seed) => (
              <li key={seed} className="flex flex-col items-center gap-3">
                <Guilloche seed={seed} className="aspect-square w-full" />
                <span className="font-mono text-xs text-ink-soft">{seed.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col gap-4">
            {seeds.slice(0, 2).map((seed) => (
              <Guilloche key={seed} seed={seed} variant="band" className="h-16 w-full" />
            ))}
          </div>
        </Section>

        <Section id="stamps" title="Stamps">
          <ul className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {samplePassport.stamps.slice(0, 5).map((stamp) => (
              <li key={stamp.eventId} className="grid place-items-center">
                <Stamp
                  eventId={stamp.eventId}
                  eventName={stamp.eventName}
                  city={stamp.city}
                  at={stamp.at}
                  mode={stamp.mode}
                  holder={SAMPLE_PASS}
                  className="w-40"
                />
              </li>
            ))}
            <li className="grid place-items-center">
              <Stamp eventId="99" eventName="A very long event name that needs to be fitted onto the arc" city="Thiruvananthapuram" at="2026-11-29T10:00:00Z" mode={2} shape="round" ink="ledger-green" className="w-40" />
            </li>
            <li className="grid place-items-center">
              <Stamp eventId="100" eventName="Judges' desk" city="Online" at="2026-12-02T10:00:00Z" mode={2} shape="oval" ink="vermilion" className="w-44" />
            </li>
            <li className="grid place-items-center">
              <Stamp eventId="101" eventName="Founders <breakfast> & co" city="Pune" at="2026-12-03T03:00:00Z" mode={1} shape="box" ink="ink" className="w-44" />
            </li>
          </ul>
          <div className="mt-10">
            <StampPressDemo />
          </div>
        </Section>

        <Section id="data" title="Addresses, amounts, transactions">
          <div className="flex flex-col items-start gap-4">
            <AddressChip address={SAMPLE_PASS} name="asha.qie" link="passport" />
            <AddressChip address={SAMPLE_WALLET} />
            <p className="text-lg">
              <Amount value="1250000000000000000000" symbol="QIE" usd={11.38} />
            </p>
            <p className="text-lg">
              <Amount value="4800000" symbol="QUSDC" />
            </p>
            <TxLink hash={SAMPLE_TX} />
          </div>
          <Ledger label="Example payout" className="mt-8 max-w-md">
            <LedgerRow label="Per verified person" value="2.00 QUSDC" />
            <LedgerRow label="Protocol fee, 2.5%" value="0.05 QUSDC" note="Capped at 5% in the contract." />
            <LedgerRow label="To the attendee, 60%" value="1.17 QUSDC" />
            <LedgerRow label="To the organizer" value="0.78 QUSDC" />
            <LedgerRow label="Settled" value="2.00 QUSDC" total />
          </Ledger>
        </Section>

        <Section id="status" title="Status, notices">
          <div className="flex flex-wrap gap-3">
            <StatusMark tone="live">Live</StatusMark>
            <StatusMark tone="scheduled">Starts 27 Nov</StatusMark>
            <StatusMark tone="ended">Ended</StatusMark>
            <StatusMark tone="attention">Refundable</StatusMark>
          </div>
          <div className="mt-6 grid max-w-2xl gap-3">
            <Notice tone="info" title="Rewards wait for a QIE ID">
              This campaign pays people whose wallet holds a QIE ID. Link one any time before 2 Dec and the reward follows.
            </Notice>
            <Notice tone="success">Your stamp is on chain.</Notice>
            <Notice tone="warning">The price feed is more than a day old, so payouts in QIE wait until it updates.</Notice>
            <Notice tone="danger" title="This door code has expired">Ask the organizer to show the door screen again, then scan the new code.</Notice>
          </div>
        </Section>

        <Section id="states" title="Loading, empty and error">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <Sheet>
              <SheetSection>
                <LoadingRegion label="Loading the event">
                  <Skeleton className="h-8 w-2/3" />
                  <SkeletonText className="mt-4" />
                  <SkeletonStamp className="mt-6 w-24" />
                </LoadingRegion>
              </SheetSection>
            </Sheet>
            <Sheet>
              <SheetSection>
                <EmptyState title="No stamps yet" as="h3" action={<Button variant="secondary">Find an event</Button>}>
                  Check in at an event and your first stamp lands here.
                </EmptyState>
              </SheetSection>
            </Sheet>
            <Sheet>
              <SheetSection>
                <ErrorState
                  title="We could not reach the QIE network"
                  as="h3"
                  reference="3f9a1c"
                  action={
                    <Button variant="quiet" leading={<RetryIcon className="size-4" />}>
                      Try again
                    </Button>
                  }
                >
                  Your check-in is saved on this phone. It sends as soon as the network answers.
                </ErrorState>
              </SheetSection>
            </Sheet>
          </div>
        </Section>

        <Section id="tabs" title="Tabs">
          <Tabs
            label="Proof modes"
            tabs={[
              { id: "door-code", label: "Rotating door code", content: <p className="max-w-prose text-ink-soft">The door screen shows a code that changes every 15 seconds.</p> },
              { id: "door-scan", label: "Door scans you", content: <p className="max-w-prose text-ink-soft">Staff scan the code on your phone.</p> },
            ]}
          />
          <LinkTabs
            className="mt-10"
            label="Campaign sections"
            current="/dev/ui"
            items={[
              { href: "/dev/ui", label: "Overview" },
              { href: "/dev/ui#tabs", label: "Events" },
              { href: "/dev/ui#data", label: "Payouts" },
            ]}
          />
        </Section>

        <Section id="qr" title="QR frame">
          <div className="max-w-xs">
            <QrFrame label="Door code for Sample builders meetup" caption="Scan with your phone camera" status="New code in 12 s">
              <span className="contents" dangerouslySetInnerHTML={{ __html: qr }} />
            </QrFrame>
          </div>
        </Section>
      </Container>
    </PageShell>
  );
}
