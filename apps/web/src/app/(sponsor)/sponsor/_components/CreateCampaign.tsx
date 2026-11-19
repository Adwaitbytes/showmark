"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { addresses, isDeployed } from "@/lib/chain/addresses";
import { activeChain, activeChainId } from "@/lib/chain/chains";
import {
  buildMetadata,
  localInputToSeconds,
  METADATA_MAX_BYTES,
  perPresenceUnits,
  secondsToLocalInput,
  TOKEN_DECIMALS,
  utf8Length,
  validateCampaignForm,
  type CampaignDraft,
  type CampaignFormValues,
  type FormErrors,
} from "@/lib/sponsor/form";
import { parseAmount, presencesCovered, splitPayout, usdToNativeWei } from "@/lib/sponsor/math";
import { useNow, useOraclePrice, useVaultConfig } from "@/lib/sponsor/use-chain";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Field, TextareaField, TextField } from "@/ui/Field";
import { basisPointsToPercent, formatCount, formatDate, formatTime, formatTokenAmount, formatUsd } from "@/ui/format";
import { ArrowRightIcon } from "@/ui/icons";
import { Ledger, LedgerRow } from "@/ui/Ledger";
import { Notice } from "@/ui/Notice";
import { Perforation } from "@/ui/Perforation";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { PROOF_MODE_COPY } from "./campaign";
import { CheckRow, ChoiceCard } from "./ChoiceCard";
import { FundingSteps } from "./FundingSteps";
import { DEFAULT_MAX_ORACLE_AGE, OraclePanel } from "./OraclePanel";
import { SponsorGate, type SponsorSeat } from "./SponsorGate";
import { TxLinkRow } from "./TxLinkRow";

function initialValues(now: number): CampaignFormValues {
  const start = Math.floor(now / 60) * 60;
  return {
    name: "",
    sponsorName: "",
    description: "",
    url: "",
    token: "QIE",
    pricing: "token",
    amount: "",
    attendeeShareBps: 5_000,
    minProofMode: 1,
    requireQieId: false,
    startsAt: secondsToLocalInput(start),
    endsAt: secondsToLocalInput(start + 14 * 86_400),
    maxPerEvent: "",
    maxTotal: "",
    openToBonded: false,
    minBond: "",
    deposit: "",
  };
}

function Part({ n, title, intro, children }: { n: number; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`part-${n}`} className="grid gap-6 border-t border-rule-soft py-10 first:border-t-0 first:pt-0 md:grid-cols-[3rem_1fr]">
      <span aria-hidden="true" className="font-display text-3xl leading-none text-ink-faint">
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 id={`part-${n}`} className="font-display text-2xl">
            {title}
          </h2>
          {intro ? <p className="max-w-prose text-base text-ink-soft">{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

function localWhen(value: string): string | null {
  const seconds = localInputToSeconds(value);
  if (seconds === null) return null;
  const iso = new Date(seconds * 1000).toISOString();
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

interface Preview {
  /** Gross per presence in payout token base units, when it can be known now. */
  gross: bigint | null;
  feeBps: number | null;
  covered: bigint | null;
}

function Receipt({
  values,
  preview,
  symbol,
  errors,
  feeUnreadable,
}: {
  values: CampaignFormValues;
  preview: Preview;
  symbol: "QIE" | "QUSDC";
  errors: FormErrors;
  feeUnreadable: boolean;
}) {
  const deposit = parseAmount(values.deposit, TOKEN_DECIMALS[symbol]);
  const split = preview.gross !== null && preview.feeBps !== null ? splitPayout(preview.gross, preview.feeBps, values.attendeeShareBps) : null;
  const t = (v: bigint) => `${formatTokenAmount(v.toString(), symbol, symbol === "QIE" ? 6 : 6)} ${symbol}`;
  const usd = values.pricing === "usd";
  const usd6 = usd ? perPresenceUnits(values) : null;
  const usdSplit = usd6 !== null && preview.feeBps !== null ? splitPayout(usd6, preview.feeBps, values.attendeeShareBps) : null;
  const u = (v: bigint) => formatUsd(Number(v) / 1e6);
  const maxTotal = /^\d+$/.test(values.maxTotal.trim()) ? Number(values.maxTotal) : null;

  return (
    <Sheet edge="stub-bottom" aria-labelledby="receipt-title">
      <SheetSection className="flex flex-col gap-4 pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="receipt-title" className="font-display text-xl">
            What this pays for
          </h2>
          <span className="font-mono text-xs text-ink-faint">chain {activeChainId}</span>
        </div>
        <div className="flex flex-col gap-1" aria-live="polite">
          <p className="font-mono text-4xl leading-none text-ink">{preview.covered !== null ? formatCount(Number(preview.covered)) : "?"}</p>
          <p className="text-sm text-ink-soft">
            {preview.covered !== null && deposit !== null && preview.gross !== null
              ? `verified people: ${t(deposit)} divided by ${t(preview.gross)} each${usd ? " at today's price" : ""}`
              : "verified people, once the amount per person and the deposit are filled in"}
          </p>
          {maxTotal !== null && preview.covered !== null && BigInt(maxTotal) < preview.covered ? (
            <p className="text-sm text-ink-soft">Your total cap stops payouts at {formatCount(maxTotal)} people; the rest is refundable.</p>
          ) : null}
        </div>
      </SheetSection>
      <Perforation />
      <SheetSection className="pt-4">
        <Ledger label="Each verified person">
          {usd && usdSplit ? (
            <>
              <LedgerRow label="Attendee gets" value={u(usdSplit.toAttendee)} />
              <LedgerRow label="Organizer gets" value={u(usdSplit.toOrganizer)} />
              <LedgerRow label={`Protocol fee, ${basisPointsToPercent(preview.feeBps ?? 0)}`} value={u(usdSplit.fee)} />
              <LedgerRow total label="Per person" value={u(usdSplit.gross)} note={split ? `About ${t(split.gross)} at today's price. Paid in QIE at the price when each person checks in.` : "Paid in QIE at the oracle price when each person checks in."} />
            </>
          ) : split ? (
            <>
              <LedgerRow label="Attendee gets" value={t(split.toAttendee)} />
              <LedgerRow label="Organizer gets" value={t(split.toOrganizer)} />
              <LedgerRow label={`Protocol fee, ${basisPointsToPercent(preview.feeBps ?? 0)}`} value={t(split.fee)} />
              <LedgerRow total label="Per person" value={t(split.gross)} note="Exactly what the vault pays. Rounding dust goes to the organizer." />
            </>
          ) : (
            <p className="py-2 text-sm text-ink-soft">
              {preview.feeBps === null
                ? feeUnreadable
                  ? "The protocol fee could not be read from the vault, so the split cannot be shown yet."
                  : "Reading the protocol fee from the vault."
                : "Fill in the amount per person to see the split."}
            </p>
          )}
        </Ledger>
        {errors.metadata ? (
          <p role="alert" className="mt-3 text-sm font-medium text-vermilion-ink">
            {errors.metadata}
          </p>
        ) : null}
      </SheetSection>
    </Sheet>
  );
}

function Created({ id, hash }: { id: string | null; hash: string }) {
  return (
    <Sheet className="mx-auto max-w-2xl">
      <SheetSection className="flex flex-col items-start gap-5">
        <p className="text-sm font-medium text-ledger-green">Funded and live on {activeChain.name}</p>
        <h1 className="font-display text-3xl">{id ? `Campaign #${id} is in escrow` : "Your campaign is in escrow"}</h1>
        <p className="text-base text-ink-soft">
          Next, approve the events it should pay for. Until you do, it only pays bonded organizers if you allowed that.
        </p>
        <TxLinkRow hash={hash} label="Creation transaction" />
        <div className="flex flex-wrap gap-3">
          {id ? (
            <Button variant="primary" href={`/sponsor/${id}`} trailing={<ArrowRightIcon className="size-4" />}>
              Approve events
            </Button>
          ) : null}
          <Button variant="quiet" href="/sponsor">
            All campaigns
          </Button>
        </div>
      </SheetSection>
    </Sheet>
  );
}

function Form({ seat }: { seat: SponsorSeat }) {
  const now = useNow(30_000);
  const [values, setValues] = useState<CampaignFormValues>(() => initialValues(Math.floor(Date.now() / 1000)));
  const [showErrors, setShowErrors] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [created, setCreated] = useState<{ id: string | null; hash: string } | null>(null);
  const oracle = useOraclePrice();
  const vault = useVaultConfig();
  const fundingRef = useRef<HTMLDivElement>(null);

  const validation = useMemo(() => validateCampaignForm(values, now, addresses.qusdc), [values, now]);
  const errors: FormErrors = showErrors && !validation.ok ? validation.errors : {};
  const set = <K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDraft(null);
  };

  const symbol = values.pricing === "usd" ? "QIE" : values.token;
  const feeBps = vault.status === "ready" ? vault.value.feeBps : null;
  const maxAge = vault.status === "ready" ? vault.value.maxOracleAge : DEFAULT_MAX_ORACLE_AGE;
  const perUnits = perPresenceUnits(values);
  const gross =
    perUnits === null || perUnits === 0n
      ? null
      : values.pricing === "usd"
        ? oracle.status === "ready"
          ? usdToNativeWei(perUnits, oracle.value.answer, oracle.value.decimals)
          : null
        : perUnits;
  const deposit = parseAmount(values.deposit, TOKEN_DECIMALS[symbol]);
  const preview: Preview = { gross, feeBps, covered: gross !== null && deposit !== null ? presencesCovered(deposit, gross) : null };
  const metadataBytes = utf8Length(buildMetadata(values));
  const qusdcHere = addresses.qusdc !== "0x0000000000000000000000000000000000000000";
  const startWhen = localWhen(values.startsAt);
  const endWhen = localWhen(values.endsAt);

  function review() {
    setShowErrors(true);
    if (!validation.ok) {
      const first = Object.keys(validation.errors)[0];
      const target = first ? document.getElementById(first === "metadata" ? "description" : first) : null;
      target?.focus();
      return;
    }
    setDraft(validation.draft);
    requestAnimationFrame(() => fundingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  if (created) return <Created id={created.id} hash={created.hash} />;

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-16">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          review();
        }}
        className="flex min-w-0 flex-col"
        aria-label="New campaign"
      >
        <Part n={1} title="What you pay for each verified person" intro="A fixed amount per person who checks in at a door you trust. Pick the token and how the amount is set.">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium text-ink">Token held in escrow</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard name="token" value="QIE" checked={values.token === "QIE"} onChange={() => set("token", "QIE")} title="QIE" tag="Default">
                Native QIE. Works on mainnet and testnet, and lets you price in US dollars.
              </ChoiceCard>
              <ChoiceCard
                name="token"
                value="QUSDC"
                checked={values.token === "QUSDC"}
                onChange={() => setValues((v) => ({ ...v, token: "QUSDC", pricing: "token" }))}
                title="QUSDC"
                disabled={!qusdcHere}
              >
                {qusdcHere ? "QIE's dollar stablecoin, 6 decimals. You approve the exact deposit first." : "QUSDC is on QIE Mainnet only."}
              </ChoiceCard>
            </div>
            {errors.token ? <p role="alert" className="text-sm font-medium text-vermilion-ink">{errors.token}</p> : null}
          </fieldset>

          {values.token === "QIE" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-sm font-medium text-ink">Pricing</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard name="pricing" value="token" checked={values.pricing === "token"} onChange={() => set("pricing", "token")} title="A fixed amount of QIE">
                  Every person is paid the same QIE, whatever the price does.
                </ChoiceCard>
                <ChoiceCard name="pricing" value="usd" checked={values.pricing === "usd"} onChange={() => set("pricing", "usd")} title="A US dollar amount, paid in QIE">
                  Converted at the QIE/USD oracle price at the moment each person is paid.
                </ChoiceCard>
              </div>
              {values.pricing === "usd" ? <OraclePanel oracle={oracle} now={now} maxAge={maxAge} onRetry={oracle.reload} /> : null}
            </fieldset>
          ) : null}

          <TextField
            id="amount"
            label={values.pricing === "usd" ? "US dollars per verified person" : `${values.token} per verified person`}
            inputMode="decimal"
            autoComplete="off"
            mono
            placeholder={values.pricing === "usd" ? "1.50" : values.token === "QIE" ? "10" : "2"}
            value={values.amount}
            onChange={(e) => set("amount", e.target.value)}
            error={errors.amount}
            hint={values.pricing === "usd" ? "Up to 6 decimal places." : `Up to ${TOKEN_DECIMALS[values.token]} decimal places.`}
            fieldClassName="max-w-xs"
          />
        </Part>

        <Part n={2} title="Split between attendee and organizer" intro="The protocol fee comes off first. The attendee gets their share of what is left and the organizer gets the rest.">
          <Field id="attendeeShareBps" label="Attendee share" hint={`Organizer share is ${basisPointsToPercent(10_000 - values.attendeeShareBps)}.`} error={errors.attendeeShareBps}>
            <div className="flex items-center gap-4">
              <input
                id="attendeeShareBps"
                type="range"
                min={0}
                max={100}
                step={5}
                value={values.attendeeShareBps / 100}
                onChange={(e) => set("attendeeShareBps", Number(e.target.value) * 100)}
                aria-valuetext={`${values.attendeeShareBps / 100} percent to the attendee, ${100 - values.attendeeShareBps / 100} percent to the organizer`}
                aria-describedby="attendeeShareBps-hint"
                className="h-11 w-full max-w-md cursor-pointer accent-[var(--vermilion)]"
              />
              <output htmlFor="attendeeShareBps" className="w-14 shrink-0 text-right font-mono text-lg text-ink">
                {basisPointsToPercent(values.attendeeShareBps)}
              </output>
            </div>
          </Field>
          <div className="lg:hidden">
            <SplitLine values={values} preview={preview} symbol={symbol} />
          </div>
        </Part>

        <Part n={3} title="Who counts as a verified person" intro="How strong the proof at the door must be before money moves, and who may be paid.">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium text-ink">Proof required at the door</legend>
            <div className="grid gap-3">
              {([1, 2] as const).map((mode) => (
                <ChoiceCard
                  key={mode}
                  name="minProofMode"
                  value={String(mode)}
                  checked={values.minProofMode === mode}
                  onChange={() => set("minProofMode", mode)}
                  title={
                    <>
                      {PROOF_MODE_COPY[mode].title} <span className="font-mono text-xs text-ink-faint">{PROOF_MODE_COPY[mode].short}</span>
                    </>
                  }
                  tag={mode === 2 ? "Strongest" : undefined}
                >
                  {PROOF_MODE_COPY[mode].body}
                  {mode === 1 ? " Mode 2 check-ins also count." : " Mode 1 check-ins are not paid."}
                </ChoiceCard>
              ))}
            </div>
          </fieldset>

          <CheckRow id="requireQieId" checked={values.requireQieId} onChange={(v) => set("requireQieId", v)} title="Only pay attendees with a QIE ID">
            The attendee&apos;s linked wallet must hold a .qie name, checked against QIE&apos;s name registry when they are paid. People who
            link a wallet with a name later are still paid until 3 days after the campaign ends. Names are free, so treat this as a light
            filter; the door signature is the real proof.
          </CheckRow>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-medium text-ink">Which events can be paid</legend>
            <div className="grid gap-3">
              <ChoiceCard name="openToBonded" value="no" checked={!values.openToBonded} onChange={() => set("openToBonded", false)} title="Only events I approve">
                You approve events one by one after creating the campaign.
              </ChoiceCard>
              <ChoiceCard name="openToBonded" value="yes" checked={values.openToBonded} onChange={() => set("openToBonded", true)} title="Also any organizer with a bond">
                Organizers who staked at least the bond below are paid without your approval. A sponsor can challenge an organizer and the
                protocol Safe can slash the bond; that arbitration is run by the Showmark team in this version.
              </ChoiceCard>
            </div>
            {values.openToBonded ? (
              <TextField
                id="minBond"
                label="Minimum organizer bond in QIE"
                inputMode="decimal"
                mono
                placeholder="100"
                value={values.minBond}
                onChange={(e) => set("minBond", e.target.value)}
                error={errors.minBond}
                fieldClassName="max-w-xs"
              />
            ) : null}
          </fieldset>
        </Part>

        <Part n={4} title="When, and how many" intro={`Only check-ins recorded between the start and the end are paid. Times are in your browser's time zone and shown below in IST.`}>
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField
              id="startsAt"
              type="datetime-local"
              label="Starts paying"
              value={values.startsAt}
              onChange={(e) => set("startsAt", e.target.value)}
              error={errors.startsAt}
              hint={startWhen ?? undefined}
            />
            <TextField
              id="endsAt"
              type="datetime-local"
              label="Stops paying"
              value={values.endsAt}
              onChange={(e) => set("endsAt", e.target.value)}
              error={errors.endsAt}
              hint={endWhen ? `${endWhen}. Unspent budget can be refunded 3 days later.` : undefined}
            />
            <TextField
              id="maxPerEvent"
              label="Most people paid per event"
              optional
              inputMode="numeric"
              mono
              placeholder="No cap"
              value={values.maxPerEvent}
              onChange={(e) => set("maxPerEvent", e.target.value)}
              error={errors.maxPerEvent}
            />
            <TextField
              id="maxTotal"
              label="Most people paid in total"
              optional
              inputMode="numeric"
              mono
              placeholder="No cap"
              value={values.maxTotal}
              onChange={(e) => set("maxTotal", e.target.value)}
              error={errors.maxTotal}
            />
          </div>
        </Part>

        <Part n={5} title="How attendees will see it" intro="Shown on event pages and in passports. Stored on-chain in the creation transaction.">
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField id="name" label="Campaign name" placeholder="Builders nights, Pune" value={values.name} onChange={(e) => set("name", e.target.value)} error={errors.name} maxLength={80} />
            <TextField id="sponsorName" label="Sponsor name" placeholder="Your company" value={values.sponsorName} onChange={(e) => set("sponsorName", e.target.value)} error={errors.sponsorName} maxLength={80} />
          </div>
          <TextareaField
            id="description"
            label="Description"
            optional
            rows={3}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            error={errors.description}
            hint={`${metadataBytes} of ${METADATA_MAX_BYTES} bytes used by name, sponsor, description and link.`}
          />
          <TextField id="url" label="Link" optional type="url" inputMode="url" placeholder="https://" value={values.url} onChange={(e) => set("url", e.target.value)} error={errors.url} />
        </Part>

        <Part n={6} title="Deposit" intro="Locked in the vault from the moment you create the campaign. Whatever is not paid out comes back to you.">
          <TextField
            id="deposit"
            label={`Deposit in ${symbol}`}
            inputMode="decimal"
            autoComplete="off"
            mono
            placeholder={symbol === "QIE" ? "1000" : "500"}
            value={values.deposit}
            onChange={(e) => set("deposit", e.target.value)}
            error={errors.deposit}
            hint="You can top up later while the campaign runs."
            fieldClassName="max-w-xs"
          />
          {showErrors && !validation.ok ? (
            <Notice tone="danger" title={`${Object.keys(validation.errors).length === 1 ? "One thing needs" : `${Object.keys(validation.errors).length} things need`} fixing before you fund`}>
              Each one is marked above with what to change.
            </Notice>
          ) : null}
          <div>
            <Button type="submit" variant="primary" size="lg" trailing={<ArrowRightIcon className="size-4" />}>
              Review and fund
            </Button>
          </div>
        </Part>

        {draft ? (
          <div ref={fundingRef} className="scroll-mt-24">
            <Sheet as="section" aria-labelledby="funding-title">
              <SheetSection className="flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <h2 id="funding-title" className="font-display text-2xl">
                    Fund it
                  </h2>
                  <p className="text-base text-ink-soft">
                    {seat.safe
                      ? "Each step is proposed to your Safe. Nothing moves until the owners confirm."
                      : "Each step opens QIE Wallet once. Nothing moves until you confirm there."}
                  </p>
                </div>
                {isDeployed() ? (
                  <FundingSteps draft={draft} seat={seat} onCreated={(id, hash) => setCreated({ id, hash })} />
                ) : (
                  <Notice tone="warning" title={`Showmark is not deployed on ${activeChain.name} yet`}>
                    The form checks out, but there is no vault to deposit into on this network. Nothing was sent.
                  </Notice>
                )}
              </SheetSection>
            </Sheet>
          </div>
        ) : null}
      </form>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Campaign summary">
        <Receipt values={values} preview={preview} symbol={symbol} errors={errors} feeUnreadable={vault.status === "error"} />
      </aside>
    </div>
  );
}

function SplitLine({ values, preview, symbol }: { values: CampaignFormValues; preview: Preview; symbol: "QIE" | "QUSDC" }) {
  if (preview.gross === null || preview.feeBps === null) {
    return <p className="text-sm text-ink-soft">Fill in the amount per person to see exactly what each side receives.</p>;
  }
  const s = splitPayout(preview.gross, preview.feeBps, values.attendeeShareBps);
  const t = (v: bigint) => `${formatTokenAmount(v.toString(), symbol, 6)} ${symbol}`;
  return (
    <p className={cn("rounded-doc bg-paper-deep px-4 py-3 text-sm text-ink-soft")}>
      Per person: attendee <span className="font-mono text-ink">{t(s.toAttendee)}</span>, organizer{" "}
      <span className="font-mono text-ink">{t(s.toOrganizer)}</span>, fee <span className="font-mono text-ink">{t(s.fee)}</span>
      {values.pricing === "usd" ? " at today's price" : ""}.
    </p>
  );
}

export function CreateCampaign() {
  return (
    <>
      <div className="mb-10 flex flex-col gap-3">
        <p className="text-sm font-medium text-vermilion-ink">New campaign</p>
        <h1 className="font-display text-3xl sm:text-4xl">Fund real attendance</h1>
        <p className="max-w-prose text-md text-ink-soft">
          Six short parts. The summary shows exactly what each person receives and how many people your deposit pays for, using the
          same arithmetic as the vault.
        </p>
      </div>
      <SponsorGate>{(seat) => <Form seat={seat} />}</SponsorGate>
    </>
  );
}
