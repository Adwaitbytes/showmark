"use client";

import type { ReactNode } from "react";
import type { Address } from "viem";
import { activeChain } from "@/lib/chain/chains";
import type { SafeContext } from "@/lib/sponsor/safe";
import type { Signer } from "@/lib/sponsor/tx";
import { useSponsorIdentity } from "@/lib/sponsor/use-sponsor";
import { connect } from "@/lib/wallet/use-wallet";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Sheet, SheetSection } from "@/ui/Sheet";
import { LoadingRegion, Skeleton } from "@/ui/Skeleton";

export interface SponsorSeat {
  account: Address;
  /** The .qie name of the signed-in wallet, when it has one. */
  name: string | null;
  signer: Signer;
  safe: SafeContext | null;
}

function GateSkeleton() {
  return (
    <LoadingRegion label="Checking your wallet" className="flex flex-col gap-4">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-11 w-48" />
    </LoadingRegion>
  );
}

function SignInSheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Sheet className="max-w-xl">
      <SheetSection className="flex flex-col gap-4">
        <h2 className="font-display text-xl">{title}</h2>
        {children}
      </SheetSection>
    </Sheet>
  );
}

/**
 * Puts the sponsor console behind a wallet. Inside safe.qie.digital the Safe is the sponsor. Elsewhere the person
 * connects QIE Wallet and signs a free sign-in message. `intro` is what a signed-out visitor reads first.
 */
export function SponsorGate({ intro, children }: { intro?: (signIn: ReactNode) => ReactNode; children: (seat: SponsorSeat) => ReactNode }) {
  const who = useSponsorIdentity();

  if (who.status === "detecting") return <GateSkeleton />;

  if (who.status === "safe") {
    if (who.wrongChain) {
      return (
        <Notice tone="warning" title={`This Safe is on another network`}>
          Showmark here runs on {activeChain.name} (chain {activeChain.id}). Open this app from a Safe on that network.
        </Notice>
      );
    }
    return <>{children({ account: who.account, name: null, signer: who.signer, safe: who.ctx })}</>;
  }

  if (who.status === "signed-in") {
    return <>{children({ account: who.account, name: who.session.qieName, signer: who.signer, safe: null })}</>;
  }

  if (who.status === "needs-sign-in") {
    if (who.checking) return <GateSkeleton />;
    return (
      <SignInSheet title="Sign in to see your campaigns">
        <p className="text-base text-ink-soft">
          Connected as <AddressChip address={who.account} copy={false} />. Signing a short message proves this wallet
          is yours. It does not send a transaction or cost anything, and the session ends after 15 minutes idle.
        </p>
        {who.error ? (
          <Notice tone="danger" title={who.error.message}>
            {who.error.action}
          </Notice>
        ) : null}
        <div>
          <Button variant="primary" onClick={who.signIn} pending={who.signingIn}>
            {who.signingIn ? "Waiting for your signature" : "Sign in with QIE Wallet"}
          </Button>
        </div>
      </SignInSheet>
    );
  }

  const { wallet } = who;
  const busy = wallet.status === "connecting" || wallet.status === "discovering";
  const sheet = (
    <SignInSheet title="Connect the wallet that will fund campaigns">
      <p className="text-base text-ink-soft">
        Showmark works with QIE Wallet on {activeChain.name}. Your deposit goes from this wallet straight into the
        vault contract; Showmark never holds it.
      </p>
      {wallet.error ? (
        <Notice tone={wallet.status === "wrong-chain" ? "warning" : "danger"} title={wallet.error.message}>
          {wallet.error.action}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void connect()} pending={busy}>
          {busy ? "Opening QIE Wallet" : "Connect QIE Wallet"}
        </Button>
        <Button variant="quiet" href="https://qiewallet.me" external>
          Get QIE Wallet
        </Button>
      </div>
    </SignInSheet>
  );
  return <>{intro ? intro(sheet) : sheet}</>;
}
