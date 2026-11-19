"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { parseEventLogs, type Address, type Hex } from "viem";
import { registryAbi } from "@/lib/chain/abi";
import { useWallet } from "@/lib/wallet/use-wallet";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { SelectField, TextareaField, TextField } from "@/ui/Field";
import { formatEventWindow } from "@/ui/format";
import { ArrowRightIcon } from "@/ui/icons";
import { Notice } from "@/ui/Notice";
import { Perforation } from "@/ui/Perforation";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { TxLink } from "@/ui/TxLink";
import { api } from "../_lib/api";
import {
  byteLength,
  DEFAULT_PASS_AGE,
  encodeSeriesMetadata,
  MAX_METADATA_BYTES,
  toLocalDateTimeValue,
  validateEventForm,
  type EventFormValues,
  type FieldErrors,
  type ValidEvent,
} from "../_lib/event-form";
import type { RegistryCall } from "../_lib/tx";
import { usePoll } from "../_lib/use-poll";
import { SignInGate } from "./SignIn";
import { GasLine, TxProgress } from "./TxFeedback";
import { useGasQuote, useRegistryTx } from "./use-registry-tx";

function defaultTimes(): { startsAt: string; endsAt: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(18, 0, 0, 0);
  const end = new Date(start);
  end.setHours(21);
  return { startsAt: toLocalDateTimeValue(start), endsAt: toLocalDateTimeValue(end) };
}

const PASS_AGE_OPTIONS = [
  [60, "1 minute: strict, for a door with good signal"],
  [120, "2 minutes: recommended"],
  [300, "5 minutes: slow mobile data or a crowded venue"],
  [600, "10 minutes: the most forgiving"],
] as const;

const FIELD_ORDER: (keyof EventFormValues)[] = ["name", "venue", "city", "description", "url", "startsAt", "endsAt", "capacity", "maxPassAge", "series", "seriesName"];

interface Created {
  eventId: bigint;
  tx: Hex;
}

function SeriesOptions({ account }: { account: Address }) {
  const events = usePoll(`series:${account}`, () => api.organizerEvents(account), 0);
  const series = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>();
    for (const e of events.data ?? []) {
      if (e.seriesId === "0") continue;
      const existing = byId.get(e.seriesId);
      if (!existing || e.seriesIndex > existing.count) byId.set(e.seriesId, { name: e.metadata.name, count: e.seriesIndex });
    }
    return [...byId.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [events.data]);
  return (
    <>
      {series.map(([id, s]) => (
        <option key={id} value={`existing:${id}`}>
          Series {id}: next after “{s.name}” ({s.count} so far)
        </option>
      ))}
    </>
  );
}

function Form({ account }: { account: Address }) {
  const wallet = useWallet();
  const walletAccount = wallet.status === "connected" ? wallet.account : null;
  const [values, setValues] = useState<EventFormValues>(() => ({
    name: "",
    venue: "",
    city: "",
    description: "",
    url: "",
    ...defaultTimes(),
    capacity: "",
    maxPassAge: String(DEFAULT_PASS_AGE),
    series: "none",
    seriesName: "",
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [createdSeries, setCreatedSeries] = useState<bigint | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [step, setStep] = useState<"series" | "event" | null>(null);
  const seriesTx = useRegistryTx();
  const eventTx = useRegistryTx();
  const formRef = useRef<HTMLFormElement>(null);

  const set = (key: keyof EventFormValues) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    if (errors[key]) setErrors((errs) => ({ ...errs, [key]: undefined }));
  };

  const preview = useMemo(() => validateEventForm(values), [values]);
  const valid: ValidEvent | null = preview.ok ? preview.value : null;
  const seriesId = valid?.series.kind === "existing" ? valid.series.seriesId : (createdSeries ?? 0n);
  const eventCall: RegistryCall | null = valid
    ? { functionName: "createEvent", args: [valid.startsAt, valid.endsAt, valid.capacity, valid.maxPassAge, seriesId, valid.metadataJson] }
    : null;
  const quoteKey = valid && walletAccount ? `${valid.metadataJson}|${valid.startsAt}|${valid.endsAt}|${valid.capacity}|${valid.maxPassAge}|${seriesId}` : null;
  const quote = useGasQuote(quoteKey, eventCall, walletAccount);
  const busy = seriesTx.busy || eventTx.busy;
  const metadataBytes = valid ? byteLength(valid.metadataJson) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = validateEventForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((k) => result.errors[k]);
      if (first) formRef.current?.querySelector<HTMLElement>(`#event-${first}`)?.focus();
      return;
    }
    if (!walletAccount) return;
    const v = result.value;
    let series = v.series.kind === "existing" ? v.series.seriesId : 0n;
    if (v.series.kind === "new") {
      if (createdSeries !== null) series = createdSeries;
      else {
        setStep("series");
        const receipt = await seriesTx.run({ functionName: "createSeries", args: [encodeSeriesMetadata(v.series.name)] }, walletAccount);
        if (!receipt) return;
        const log = parseEventLogs({ abi: registryAbi, eventName: "SeriesCreated", logs: receipt.logs })[0];
        if (!log) return;
        series = log.args.seriesId;
        setCreatedSeries(series);
      }
    }
    setStep("event");
    const receipt = await eventTx.run(
      { functionName: "createEvent", args: [v.startsAt, v.endsAt, v.capacity, v.maxPassAge, series, v.metadataJson] },
      walletAccount,
    );
    if (!receipt) return;
    const log = parseEventLogs({ abi: registryAbi, eventName: "EventCreated", logs: receipt.logs })[0];
    if (log) setCreated({ eventId: log.args.eventId, tx: receipt.transactionHash });
  }

  if (created) {
    return (
      <Container width="prose" className="py-14">
        <Sheet edge="stub-bottom">
          <SheetSection className="flex flex-col gap-5">
            <p className="text-sm font-medium text-ink-soft">Recorded on QIE</p>
            <h1 className="font-display text-4xl text-ink">{values.name.trim()} is event {created.eventId.toString()}</h1>
            <p className="text-md text-ink-soft">
              Next, open the door screen on the device you will use at the entrance. It makes its own door key and asks your wallet to approve it once.
            </p>
            <TxLink hash={created.tx}>View the transaction on the explorer</TxLink>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button href={`/door/${created.eventId}`} variant="primary" size="lg" trailing={<ArrowRightIcon className="size-4" />}>
                Open the door screen
              </Button>
              <Button href={`/organize/${created.eventId}`} size="lg">
                Go to the event
              </Button>
            </div>
          </SheetSection>
        </Sheet>
      </Container>
    );
  }

  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = valid ? formatEventWindow(new Date(Number(valid.startsAt) * 1000).toISOString(), new Date(Number(valid.endsAt) * 1000).toISOString()) : null;

  return (
    <Container className="py-10 sm:py-14">
      <div className="mb-10 flex max-w-2xl flex-col gap-3">
        <p className="text-sm font-medium text-ink-soft">New event</p>
        <h1 className="font-display text-4xl text-ink sm:text-5xl">Create an event</h1>
        <p className="text-md text-ink-soft">
          Everything here is written to QIE from your wallet. The name and details can be edited later; the times cannot, so check them twice.
        </p>
      </div>

      <form ref={formRef} onSubmit={submit} noValidate className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex flex-col gap-8">
          <Sheet as="section" aria-labelledby="about-title">
            <SheetSection className="flex flex-col gap-5">
              <h2 id="about-title" className="font-display text-xl">
                About the event
              </h2>
              <TextField id="event-name" label="Event name" value={values.name} onChange={set("name")} error={errors.name} placeholder="Builders night" autoComplete="off" />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField id="event-venue" label="Venue" value={values.venue} onChange={set("venue")} error={errors.venue} placeholder="Hall B, second floor" />
                <TextField id="event-city" label="City" value={values.city} onChange={set("city")} error={errors.city} placeholder="Bengaluru" autoComplete="address-level2" />
              </div>
              <TextareaField
                id="event-description"
                label="Description"
                optional
                value={values.description}
                onChange={set("description")}
                error={errors.description}
                hint={metadataBytes !== null ? `Shown on the public event page. ${metadataBytes.toLocaleString("en-US")} of ${MAX_METADATA_BYTES.toLocaleString("en-US")} bytes used.` : "Shown on the public event page."}
              />
              <TextField id="event-url" label="Event link" optional type="url" value={values.url} onChange={set("url")} error={errors.url} placeholder="https://" hint="Your Luma, Meetup or college page." />
            </SheetSection>
          </Sheet>

          <Sheet as="section" aria-labelledby="when-title">
            <SheetSection className="flex flex-col gap-5">
              <h2 id="when-title" className="font-display text-xl">
                When
              </h2>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField id="event-startsAt" label="Starts" type="datetime-local" value={values.startsAt} onChange={set("startsAt")} error={errors.startsAt} />
                <TextField id="event-endsAt" label="Ends" type="datetime-local" value={values.endsAt} onChange={set("endsAt")} error={errors.endsAt} />
              </div>
              <p className="text-sm text-ink-soft">
                Times are in this device’s time zone, {deviceZone}. Check-in opens one hour before the start and closes one hour after the end.
                {when ? ` In India time that is ${when}.` : ""}
              </p>
            </SheetSection>
          </Sheet>

          <Sheet as="section" aria-labelledby="door-title">
            <SheetSection className="flex flex-col gap-5">
              <h2 id="door-title" className="font-display text-xl">
                At the door
              </h2>
              <TextField
                id="event-capacity"
                label="Capacity"
                optional
                inputMode="numeric"
                value={values.capacity}
                onChange={set("capacity")}
                error={errors.capacity}
                placeholder="No limit"
                hint="How many people the room holds. Check-in stops at this number. You can raise it later."
              />
              <SelectField
                id="event-maxPassAge"
                label="How long a door code stays valid"
                value={values.maxPassAge}
                onChange={set("maxPassAge")}
                error={errors.maxPassAge}
                hint="The code on the screen changes every 15 seconds. This is how long a scanned code still works afterwards, for phones on slow data. Shorter makes a forwarded photo useless sooner."
              >
                {PASS_AGE_OPTIONS.map(([seconds, label]) => (
                  <option key={seconds} value={seconds}>
                    {label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="event-series"
                label="Part of a series"
                value={values.series}
                onChange={set("series")}
                error={errors.series}
                hint="For a recurring meetup. People who come to each one in a row build a streak, and sponsors can reward streaks."
              >
                <option value="none">No, a one-off event</option>
                <option value="new">Start a new series with this event</option>
                <SeriesOptions account={account} />
              </SelectField>
              {values.series === "new" ? (
                <TextField id="event-seriesName" label="Series name" value={values.seriesName} onChange={set("seriesName")} error={errors.seriesName} placeholder="Builders night, weekly" />
              ) : null}
            </SheetSection>
          </Sheet>

          <Sheet as="section" tone="inset" aria-labelledby="proof-title">
            <SheetSection className="flex flex-col gap-4">
              <h2 id="proof-title" className="font-display text-xl">
                Which check-in to use at the door
              </h2>
              <p className="text-base text-ink-soft">You do not choose this now. Both work for every event, and you can switch at the door at any time.</p>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <dt className="font-medium text-ink">Door code (mode 1)</dt>
                  <dd className="text-ink-soft">A screen shows a code that changes every 15 seconds and people scan it themselves. No staff needed, good for a crowd. Use this by default.</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="font-medium text-ink">Door scans you (mode 2)</dt>
                  <dd className="text-ink-soft">A helper scans each attendee’s own code. Slower, but tied to that person and it works without internet. Use it when a sponsor asks for it.</dd>
                </div>
              </dl>
            </SheetSection>
          </Sheet>
        </div>

        <aside className="lg:sticky lg:top-24">
          <Sheet edge="stub-top">
            <SheetSection className="flex flex-col gap-4">
              <h2 className="font-display text-xl">Create on QIE</h2>
              {when ? <p className="text-base text-ink">{when}</p> : <p className="text-base text-ink-soft">Fill in the details to see the summary.</p>}
              <Perforation className="-mx-5 sm:-mx-8" />
              {values.series === "new" && createdSeries === null ? (
                <p className="text-sm text-ink-soft">This takes two transactions: one to start the series, then one for the event.</p>
              ) : null}
              <Button type="submit" variant="primary" size="lg" block pending={busy} disabled={!walletAccount || (quote.kind === "ready" && !quote.quote.enough)}>
                Create the event
              </Button>
              {!walletAccount ? (
                <Notice tone="warning" title="QIE Wallet is not connected">
                  Reload the page and connect QIE Wallet to create the event.
                </Notice>
              ) : seriesTx.phase.kind === "idle" && eventTx.phase.kind === "idle" ? (
                <GasLine quote={quote} account={walletAccount} />
              ) : null}
              {step === "series" || seriesTx.phase.kind !== "idle" ? (
                <TxProgress phase={seriesTx.phase} account={walletAccount} doneTitle="Series started" />
              ) : null}
              {step === "event" ? <TxProgress phase={eventTx.phase} account={walletAccount} doneTitle="Event created" /> : null}
            </SheetSection>
          </Sheet>
        </aside>
      </form>
    </Container>
  );
}

export function NewEventForm() {
  return <SignInGate>{(session) => <Form account={session.address} />}</SignInGate>;
}
