"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { describeSkew } from "@/lib/door/clock";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorState } from "@/ui/ErrorState";
import { formatDate, formatTime } from "@/ui/format";
import { RetryIcon } from "@/ui/icons";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";
import { ShowmarkSeal } from "@/ui/Wordmark";
import { AuthorizeDoor } from "./AuthorizeDoor";
import type { DoorSetup } from "./use-door";
import "./door.css";

/** The full-height frame every door view sits in. No site header: the door is a single-purpose object. */
export function DoorFrame({ bar, children, className }: { bar?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <main id="main" tabIndex={-1} className={cn("flex min-h-dvh flex-col focus:outline-none", className)}>
      {bar}
      <div className="flex flex-1 flex-col">{children}</div>
    </main>
  );
}

export function DoorBar({ title, children, hidden = false }: { title: string; children?: ReactNode; hidden?: boolean }) {
  return (
    <header
      className={cn(
        "flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 transition-opacity duration-300 sm:px-6",
        hidden && "pointer-events-none opacity-0",
      )}
    >
      <Link href="/organize" className="inline-flex min-h-11 items-center gap-2 rounded-doc text-base text-ink-soft hover:text-ink">
        <ShowmarkSeal className="size-6" />
        <span className="font-display text-lg text-ink">Showmark</span>
        <span aria-hidden="true" className="text-rule">
          /
        </span>
        <span>{title}</span>
      </Link>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

/** Small status pills along the top of the door: network, clock and screen lock. Words carry the meaning. */
export function DoorSignals({ setup, wake }: { setup: DoorSetup; wake?: string }) {
  const items: { tone: "ok" | "warn"; text: string }[] = [];
  items.push(setup.online ? { tone: "ok", text: "Online" } : { tone: "warn", text: "Offline" });
  if (setup.clock.skewed && setup.clock.offsetMs !== null) items.push({ tone: "warn", text: "Clock is off" });
  if (wake === "denied" || wake === "unsupported") items.push({ tone: "warn", text: "Screen may sleep" });
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Door status">
      {items.map((item) => (
        <li
          key={item.text}
          className={cn(
            "h-8 items-center gap-2 rounded-pill px-3 text-sm shadow-[inset_0_0_0_1px_var(--rule-soft)]",
            // On a phone only problems earn space in the bar.
            item.tone === "warn" ? "inline-flex text-ink" : "hidden text-ink-soft sm:inline-flex",
          )}
        >
          <span aria-hidden="true" className={cn("size-1.5 rounded-pill", item.tone === "warn" ? "bg-vermilion" : "bg-ledger-green")} />
          {item.text}
        </li>
      ))}
    </ul>
  );
}

/** Warnings an organizer must act on before the doors open. */
export function DoorWarnings({ setup, wake }: { setup: DoorSetup; wake?: string }) {
  const warnings: { title: string; body: string }[] = [];
  if (setup.clock.skewed && setup.clock.offsetMs !== null) {
    const direction = setup.clock.offsetMs > 0 ? "behind" : "ahead of";
    warnings.push({
      title: `This device’s clock is ${describeSkew(setup.clock.offsetMs)} ${direction} the QIE network`,
      body: "Codes still use network time, so check-in works, but set the clock to automatic in the device settings to be safe.",
    });
  }
  if (!setup.online) {
    warnings.push({
      title: "This screen is offline",
      body: "Codes keep changing, but phones need internet to check in and the count cannot update. Connect to Wi-Fi or a phone hotspot.",
    });
  }
  if (wake === "denied" || wake === "unsupported") {
    warnings.push({ title: "This screen may go to sleep", body: "Turn off sleep and screen lock in the device settings, and keep it plugged in." });
  }
  if (warnings.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-2 px-4 sm:px-6">
      {warnings.map((w) => (
        <div key={w.title} className="flex gap-3 rounded-doc bg-paper-deep px-4 py-3">
          <span aria-hidden="true" className="mt-[0.55em] size-2 shrink-0 rotate-45 bg-vermilion" />
          <p className="text-base">
            <span className="font-medium text-ink">{w.title}.</span> <span className="text-ink-soft">{w.body}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8">{children}</div>;
}

/**
 * Everything the door shows before it is ready to sign: loading, missing contracts, unknown event, a browser that
 * cannot store a key, a key that needs authorizing, and the reset state. Returns null once the door is ready.
 */
export function DoorSetupView({ setup, purpose = "show" }: { setup: DoorSetup; purpose?: "show" | "scan" }) {
  const { phase } = setup;
  const eventLabel = setup.eventId === null ? "" : setup.eventId.toString();
  switch (phase.kind) {
    case "ready":
      return null;
    case "loading":
      return (
        <Centered>
          <LoadingRegion label="Loading the door screen" className="flex w-full max-w-3xl flex-col items-center gap-8 sm:flex-row">
            <Skeleton className="aspect-square w-full max-w-sm" />
            <div className="flex w-full flex-col gap-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-32 w-48" />
              <Skeleton className="h-5 w-56" />
            </div>
          </LoadingRegion>
        </Centered>
      );
    case "not-deployed":
      return (
        <Centered>
          <EmptyState title="Showmark is not live on this network yet" action={<Button href="/">Back to Showmark</Button>}>
            The door screen signs codes for the Showmark registry, which has not been deployed here. Come back once the contracts are live.
          </EmptyState>
        </Centered>
      );
    case "invalid-id":
      return (
        <Centered>
          <ErrorState title="This door link is not valid" as="h1" action={<Button href="/organize">Open your events</Button>}>
            The event number in the link is missing or malformed. Open the door screen from the event page in the organizer console.
          </ErrorState>
        </Centered>
      );
    case "load-failed":
      return (
        <Centered>
          <ErrorState
            title="The door screen could not reach the QIE network"
            as="h1"
            action={
              <Button onClick={setup.retry} leading={<RetryIcon className="size-4" />}>
                Try again
              </Button>
            }
          >
            Check the internet connection on this device. If the Wi-Fi is down, connect to a phone hotspot, then try again.
          </ErrorState>
        </Centered>
      );
    case "not-found":
      return (
        <Centered>
          <ErrorState title={`There is no event ${eventLabel} on Showmark`} as="h1" action={<Button href="/organize">Open your events</Button>}>
            Check the event number in the link. If you just created the event, wait a few seconds for the transaction to land and reload.
          </ErrorState>
        </Centered>
      );
    case "no-storage":
      return (
        <Centered>
          <ErrorState title="This browser cannot keep a door key" as="h1">
            Private windows and some in-app browsers do not let pages save anything. Open this link in a normal Chrome or Safari window on the door device.
          </ErrorState>
        </Centered>
      );
    case "released":
      return (
        <Centered>
          <EmptyState
            as="h2"
            title="This device is no longer a door"
            action={
              <div className="flex flex-wrap gap-3">
                <Button href={setup.eventId ? `/organize/${setup.eventId}` : "/organize"} variant="secondary">
                  Back to the event
                </Button>
                <Button onClick={() => window.location.reload()}>Set it up again</Button>
              </div>
            }
          >
            The door key was removed from this browser. Codes from this device will not work again.
          </EmptyState>
        </Centered>
      );
    case "needs-auth":
      if (!setup.event || !setup.doorKey || setup.eventId === null) return null;
      return (
        <Centered>
          <AuthorizeDoor
            eventId={setup.eventId}
            event={setup.event}
            eventName={setup.details?.metadata.name ?? null}
            doorKey={setup.doorKey.address}
            revoked={phase.revoked}
            purpose={purpose}
            onAuthorized={setup.markAuthorized}
          />
        </Centered>
      );
  }
}

/** Shown in place of the code before check-in opens and after it closes. */
export function WindowNotice({ state, startsAt, endsAt, eventId }: { state: "before" | "closed"; startsAt: bigint; endsAt: bigint; eventId: bigint }) {
  const opens = new Date(Number(startsAt - 3600n) * 1000).toISOString();
  const closed = new Date(Number(endsAt + 3600n) * 1000).toISOString();
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-doc bg-paper-deep p-[8%] text-center">
      {state === "before" ? (
        <>
          <p className="font-display text-[clamp(1.75rem,5vmin,3.5rem)] leading-tight text-ink">Check-in opens at {formatTime(opens)}</p>
          <p className="text-[clamp(1rem,2.2vmin,1.5rem)] text-ink-soft">
            {formatDate(opens)}. The code appears here by itself, one hour before the start. Keep this screen open.
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-[clamp(1.75rem,5vmin,3.5rem)] leading-tight text-ink">Check-in has closed</p>
          <p className="text-[clamp(1rem,2.2vmin,1.5rem)] text-ink-soft">
            It closed at {formatTime(closed)} on {formatDate(closed)}, one hour after the end.{" "}
            <Link href={`/organize/${eventId}`} className="text-stamp-blue underline underline-offset-4">
              See the attendee list
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The event name as a heading. Until the API answers, a skeleton holds its place instead of a bare "Event 8", which
 * reads like a broken screen from across a hall. Screen readers still hear the event number.
 */
export function EventName({ name, eventId, className, testId, id }: { name: string | null; eventId: bigint | null; className?: string; testId?: string; id?: string }) {
  if (name) {
    return (
      <h1 id={id} className={className} data-testid={testId}>
        {name}
      </h1>
    );
  }
  return (
    <h1 id={id} className={cn(className, "w-full")} data-testid={testId} aria-busy="true">
      <span className="sr-only">{eventId === null ? "Door" : `Event ${eventId}`}</span>
      <Skeleton className="h-[0.9em] w-[min(100%,12ch)]" />
    </h1>
  );
}
