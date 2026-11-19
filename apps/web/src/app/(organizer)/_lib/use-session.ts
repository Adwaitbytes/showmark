"use client";

import { useCallback, useEffect, useState } from "react";
import { isAddressEqual, type Address } from "viem";
import type { Session } from "@/lib/api/types";
import { toWalletError, type WalletError } from "@/lib/wallet/wallet-store";
import { connect, useWallet, walletClient } from "@/lib/wallet/use-wallet";
import { api, ApiRequestError, errorCopy, type ErrorCopy } from "./api";

export type SessionStatus = "checking" | "signed-out" | "signing-in" | "signed-in";

export interface SessionState {
  status: SessionStatus;
  session: Session | null;
  /** The connected wallet's .qie name, looked up before sign-in so the button can say "Sign in with QIE ID". */
  walletName: string | null;
  error: ErrorCopy | WalletError | null;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * The organizer session: a short-lived cookie from /api/auth/* after the wallet signs a sign-in message. The session
 * only counts while the wallet that signed it is still the connected one, so switching accounts signs you out.
 */
export function useOrganizerSession(): SessionState {
  const wallet = useWallet();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [error, setError] = useState<ErrorCopy | WalletError | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .session()
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setStatus(s ? "signed-in" : "signed-out");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSession(null);
        setStatus("signed-out");
        setError(errorCopy(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const account = wallet.account;
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    api
      .qieName(account)
      .then((name) => {
        if (!cancelled) setWalletName(name);
      })
      .catch(() => {
        // The name only changes a button label; without it the button says "Sign in with QIE Wallet".
        if (!cancelled) setWalletName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  const signIn = useCallback(async () => {
    setError(null);
    setStatus("signing-in");
    try {
      let address: Address | null = wallet.status === "connected" ? wallet.account : null;
      if (!address) address = await connect();
      const client = walletClient();
      if (!address || !client) {
        setStatus("signed-out");
        return;
      }
      const { message } = await api.challenge(address);
      const signature = await client.signMessage({ account: address, message });
      const next = await api.verify(message, signature);
      setSession(next);
      setStatus("signed-in");
    } catch (e) {
      setStatus("signed-out");
      setError(e instanceof ApiRequestError ? e.copy : toWalletError(e));
    }
  }, [wallet.status, wallet.account]);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } catch (e) {
      setError(errorCopy(e));
    }
    setSession(null);
    setStatus("signed-out");
  }, []);

  // A session for one wallet while another is connected would show the wrong events.
  const mismatch = session !== null && account !== null && !isAddressEqual(session.address, account);

  return {
    status: mismatch ? "signed-out" : status,
    session: mismatch ? null : session,
    walletName,
    error: wallet.error ?? error,
    signIn,
    signOut,
  };
}
