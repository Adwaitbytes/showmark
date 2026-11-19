"use client";

import { useCallback, useEffect, useState } from "react";
import { isAddressEqual, type Address } from "viem";
import type { Session } from "@/lib/api/types";
import { useWallet, walletClient } from "@/lib/wallet/use-wallet";
import type { WalletState } from "@/lib/wallet/wallet-store";
import { ApiRequestError } from "./api";
import { toPlainError, type PlainError } from "./errors";
import { detectSafe, safeOnWrongChain, type SafeContext } from "./safe";
import { readSession, signIn } from "./session";
import type { Signer } from "./tx";

export type SponsorIdentity =
  | { status: "detecting" }
  | { status: "safe"; account: Address; signer: Signer; ctx: SafeContext; wrongChain: boolean }
  | { status: "signed-out"; wallet: WalletState }
  | { status: "needs-sign-in"; account: Address; checking: boolean; signingIn: boolean; error: PlainError | null; signIn: () => void }
  | { status: "signed-in"; account: Address; session: Session; signer: Signer };

interface SessionState {
  account: Address | null;
  session: Session | null;
  checking: boolean;
  signingIn: boolean;
  error: PlainError | null;
}

const EMPTY: SessionState = { account: null, session: null, checking: false, signingIn: false, error: null };

/**
 * Who is using the sponsor console. Inside safe.qie.digital the Safe is the sponsor and needs no sign-in (it reads
 * only public chain data and proposes every write to its owners). Elsewhere it is the connected QIE Wallet with a
 * signed-in session for the same address.
 */
export function useSponsorIdentity(): SponsorIdentity {
  const wallet = useWallet();
  const [safe, setSafe] = useState<SafeContext | null | undefined>(undefined);
  const [session, setSession] = useState<SessionState>(EMPTY);

  useEffect(() => {
    let live = true;
    void detectSafe().then((ctx) => {
      if (live) setSafe(ctx);
    });
    return () => {
      live = false;
    };
  }, []);

  const account = wallet.status === "connected" ? wallet.account : null;

  useEffect(() => {
    if (safe !== null || !account) return;
    let live = true;
    // While this read is in flight, session.account still names the previous account, which reads as "checking".
    readSession()
      .then((current) => {
        if (!live) return;
        const mine = current && isAddressEqual(current.address, account) ? current : null;
        setSession({ ...EMPTY, account, session: mine });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const copy = error instanceof ApiRequestError ? error.copy : toPlainError(error);
        setSession({ ...EMPTY, account, error: copy });
      });
    return () => {
      live = false;
    };
  }, [account, safe]);

  const startSignIn = useCallback(() => {
    const client = walletClient();
    if (!client || !account) return;
    setSession((s) => ({ ...s, signingIn: true, error: null }));
    signIn(client, account)
      .then((next) => setSession({ ...EMPTY, account, session: next }))
      .catch((error: unknown) => {
        const copy = error instanceof ApiRequestError ? error.copy : toPlainError(error);
        setSession({ ...EMPTY, account, error: copy });
      });
  }, [account]);

  if (safe === undefined) return { status: "detecting" };
  if (safe) {
    return {
      status: "safe",
      account: safe.safe,
      ctx: safe,
      wrongChain: safeOnWrongChain(safe),
      signer: { kind: "safe", account: safe.safe, ctx: safe },
    };
  }
  if (!account) return { status: "signed-out", wallet };
  const client = walletClient();
  if (session.account === account && session.session && client) {
    return { status: "signed-in", account, session: session.session, signer: { kind: "wallet", account, client } };
  }
  return {
    status: "needs-sign-in",
    account,
    checking: session.account !== account || session.checking,
    signingIn: session.signingIn,
    error: session.account === account ? session.error : null,
    signIn: startSignIn,
  };
}
