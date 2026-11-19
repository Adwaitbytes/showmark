"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, reconnect, subscribe, type WalletState } from "./wallet-store";

export { connect, disconnect, refreshWallets, walletClient } from "./wallet-store";

/** Current wallet connection. Restores a previous QIE Wallet connection silently on first use. */
export function useWallet(): WalletState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (getSnapshot().status === "idle") {
      reconnect().catch(() => {
        // A failed silent reconnect leaves the user on the normal "connect" button, which is the right fallback.
      });
    }
  }, []);
  return state;
}
