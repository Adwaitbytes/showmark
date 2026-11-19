"use client";

import type { ReactNode } from "react";
import type { Session } from "@/lib/api/types";
import { isDeployed } from "@/lib/chain/addresses";
import { useWallet } from "@/lib/wallet/use-wallet";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { Container } from "@/ui/Container";
import { EmptyState } from "@/ui/EmptyState";
import { Notice } from "@/ui/Notice";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton, SkeletonText } from "@/ui/Skeleton";
import { useOrganizerSession, type SessionState } from "../_lib/use-session";

const STEPS = [
  ["Create the event", "Name, place, time and capacity, recorded on QIE from your wallet for a fee of well under a cent."],
  ["Open the door screen", "On a laptop or tablet at the entrance. It shows a code that changes every 15 seconds."],
  ["People check in", "They point their camera at the screen and tap once. No app, no wallet, nothing to pay."],
] as const;

export function SignInCard({ state }: { state: SessionState }) {
  const wallet = useWallet();
  const label = state.walletName ? "Sign in with QIE ID" : "Sign in with QIE Wallet";
  return (
    <Container className="py-12 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-20">
        <div className="flex flex-col gap-6">
          <p className="text-sm font-medium tracking-[0.12em] text-ink-soft uppercase">Organizer console</p>
          <h1 className="font-display text-4xl text-balance text-ink sm:text-5xl">Run check-in at your event</h1>
          <p className="max-w-[46ch] text-md text-ink-soft">
            Every person who walks through your door gets a stamp in their passport, and if a sponsor is paying for your event, each check-in pays you and the attendee.
          </p>
          <ol className="flex flex-col gap-4 pt-2">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-pill font-display text-lg text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]">
                  {i + 1}
                </span>
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{title}</span>
                  <span className="text-ink-soft">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <Sheet edge="stub-bottom">
          <SheetSection className="flex flex-col gap-5">
            <h2 className="font-display text-2xl text-ink">Sign in</h2>
            <p className="text-base text-ink-soft">
              Your wallet signs a short message to prove it is you. It does not send a transaction and costs nothing.
            </p>
            {wallet.account ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                Connected <AddressChip address={wallet.account} name={state.walletName} copy={false} link="none" />
              </p>
            ) : null}
            <Button variant="primary" size="lg" block onClick={() => void state.signIn()} pending={state.status === "signing-in"}>
              {label}
            </Button>
            {state.error ? (
              <Notice tone="danger" title={state.error.message}>
                {state.error.action}
              </Notice>
            ) : null}
            <p className="text-sm text-ink-soft">
              No QIE Wallet yet? Install it from{" "}
              <a href="https://qiewallet.me" target="_blank" rel="noopener noreferrer" className="text-stamp-blue underline underline-offset-4">
                qiewallet.me
              </a>
              , then reload this page.
            </p>
          </SheetSection>
        </Sheet>
      </div>
    </Container>
  );
}

function SessionSkeleton() {
  return (
    <Container className="py-12">
      <LoadingRegion label="Checking your sign-in" className="flex flex-col gap-6">
        <Skeleton className="h-12 w-72" />
        <SkeletonText lines={2} className="max-w-md" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </LoadingRegion>
    </Container>
  );
}

export function NotDeployedState() {
  return (
    <Container className="py-16">
      <EmptyState as="h1" title="Showmark is not live on this network yet" action={<Button href="/">Back to Showmark</Button>}>
        Events are created on the Showmark registry, which has not been deployed here yet. Come back once the contracts are live.
      </EmptyState>
    </Container>
  );
}

/** Shows the sign-in card until the organizer has a session, then renders the console with it. */
export function SignInGate({ children }: { children: (session: Session, state: SessionState) => ReactNode }) {
  const state = useOrganizerSession();
  if (!isDeployed()) return <NotDeployedState />;
  if (state.status === "checking") return <SessionSkeleton />;
  if (state.status !== "signed-in" || !state.session) return <SignInCard state={state} />;
  return <>{children(state.session, state)}</>;
}
