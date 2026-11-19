"use client";

import type { Address, WalletClient } from "viem";
import { createSiweMessage } from "viem/siwe";
import { z } from "zod";
import type { Session } from "@/lib/api/types";
import { activeChainId } from "@/lib/chain/chains";
import { ApiRequestError, apiGet, apiPost, sessionSchema } from "./api";

// Sign in with QIE Wallet: an EIP-4361 message signed by the wallet, exchanged at /api/auth/verify for a short-lived
// httpOnly session cookie (INTERFACES section 3). The message names this site and chain, so it cannot be replayed
// against another site or network.

const nonceSchema = z.object({ nonce: z.string().min(8).max(128) });

export const SIGN_IN_STATEMENT = "Sign in to the Showmark sponsor console. This does not send a transaction or cost anything.";

/** The current session, or null when signed out (401). Other failures throw ApiRequestError. */
export async function readSession(): Promise<Session | null> {
  try {
    return await apiGet("/api/auth/session", sessionSchema);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export function buildSignInMessage(input: { address: Address; nonce: string; host: string; origin: string; now: Date }): string {
  return createSiweMessage({
    address: input.address,
    chainId: activeChainId,
    domain: input.host,
    uri: input.origin,
    nonce: input.nonce,
    version: "1",
    statement: SIGN_IN_STATEMENT,
    issuedAt: input.now,
    expirationTime: new Date(input.now.getTime() + 10 * 60_000),
  });
}

/** Asks the wallet to sign the sign-in message and starts a session. */
export async function signIn(client: WalletClient, address: Address): Promise<Session> {
  const { nonce } = await apiGet("/api/auth/nonce", nonceSchema, { cache: "no-store" });
  const message = buildSignInMessage({
    address,
    nonce,
    host: window.location.host,
    origin: window.location.origin,
    now: new Date(),
  });
  const signature = await client.signMessage({ account: address, message });
  return apiPost("/api/auth/verify", { message, signature }, sessionSchema);
}
