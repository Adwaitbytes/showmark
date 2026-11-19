"use client";

import { isAddressEqual, type Address, type WalletClient } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import type { Session } from "@/lib/api/types";
import { activeChainId } from "@/lib/chain/chains";
import { ApiRequestError, apiGet, apiPost, sessionSchema } from "./api";

// Sign in with QIE Wallet: the server issues an EIP-4361 message with a single-use nonce (/api/auth/nonce), the
// wallet signs it, and /api/auth/verify exchanges it for a short-lived httpOnly session cookie.

const challengeSchema = z.object({
  nonce: z.string().min(8),
  message: z.string().min(1).max(4_000),
  issuedAt: z.string(),
  expiresAt: z.string(),
});

/** The current session, or null when signed out (401). Other failures throw ApiRequestError. */
export async function readSession(): Promise<Session | null> {
  try {
    return await apiGet("/api/auth/session", sessionSchema, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

/**
 * The wallet will sign whatever we hand it, so check the server's message says what we expect before asking:
 * this address, this site, this chain, and the nonce we were given.
 */
export function challengeMatches(message: string, expected: { address: Address; host: string; nonce: string }): boolean {
  try {
    const parsed = parseSiweMessage(message);
    return (
      parsed.address !== undefined &&
      isAddressEqual(parsed.address, expected.address) &&
      parsed.domain === expected.host &&
      parsed.chainId === activeChainId &&
      parsed.nonce === expected.nonce
    );
  } catch {
    return false;
  }
}

const MISMATCH = {
  message: "The sign-in message did not match this site or wallet, so it was not sent to your wallet.",
  action: "Reload the page and sign in again.",
};

/** Asks the wallet to sign the server's sign-in message and starts a session. */
export async function signIn(client: WalletClient, address: Address): Promise<Session> {
  const challenge = await apiGet(`/api/auth/nonce?address=${address}`, challengeSchema, { cache: "no-store" });
  if (!challengeMatches(challenge.message, { address, host: window.location.host, nonce: challenge.nonce })) {
    throw new ApiRequestError(0, MISMATCH);
  }
  const signature = await client.signMessage({ account: address, message: challenge.message });
  return apiPost("/api/auth/verify", { message: challenge.message, signature }, sessionSchema);
}

const SIGN_OUT_FAILED = {
  message: "Showmark could not end your session just now.",
  action: "Try again. The session also ends by itself after 15 minutes idle.",
};

/** Ends the session (DELETE /api/auth/session). The caller disconnects the wallet afterwards. */
export async function signOut(): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" });
  } catch {
    throw new ApiRequestError(0, SIGN_OUT_FAILED);
  }
  if (!response.ok) throw new ApiRequestError(response.status, SIGN_OUT_FAILED);
}
