import { getAddress, isAddressEqual, type Address, type Hex, type PublicClient } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { z } from "zod";
import { AppError, AUTH_ERRORS, COMMON_ERRORS } from "../errors";
import type { KeyValueStore } from "../kv";

// Sign in with a wallet signature, EIP-4361 (SIWE) format. The server writes the whole message, so the wallet
// shows the same text every time and the server never has to trust fields the client chose.
// The nonce lives in Redis for five minutes and is consumed on first use (GETDEL), so a signature works once.

export const NONCE_TTL_SECONDS = 5 * 60;
const CLOCK_SKEW_MS = 60_000;

const storedNonceSchema = z.object({ address: z.string(), domain: z.string(), chainId: z.number() });

export interface SignInRequest {
  address: Address;
  /** Host the user is signing in on, for example `showmark.app`. Taken from the request, never from the body. */
  domain: string;
  /** Origin of the site, for example `https://showmark.app`. */
  uri: string;
  chainId: number;
  now: Date;
}

export interface SignInChallenge {
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
}

const nonceKey = (nonce: string) => `auth:nonce:${nonce}`;

export async function createChallenge(kv: KeyValueStore, req: SignInRequest): Promise<SignInChallenge> {
  const nonce = generateSiweNonce();
  const expirationTime = new Date(req.now.getTime() + NONCE_TTL_SECONDS * 1000);
  const message = createSiweMessage({
    address: req.address,
    chainId: req.chainId,
    domain: req.domain,
    nonce,
    uri: req.uri,
    version: "1",
    issuedAt: req.now,
    expirationTime,
    statement: "Sign in to Showmark. This request does not send a transaction or cost gas.",
  });
  await kv.set(nonceKey(nonce), JSON.stringify({ address: req.address, domain: req.domain, chainId: req.chainId }), { px: NONCE_TTL_SECONDS * 1000 });
  return { nonce, message, issuedAt: req.now.toISOString(), expiresAt: expirationTime.toISOString() };
}

export interface VerifyRequest {
  message: string;
  signature: Hex;
  domain: string;
  chainId: number;
  now: Date;
}

/**
 * Checks the message against what this server issued and verifies the signature with `verifyMessage`, which also
 * accepts contract wallets (ERC-1271) and counterfactual ones (ERC-6492). Returns the signer.
 */
export async function verifySignIn(kv: KeyValueStore, client: PublicClient, req: VerifyRequest): Promise<Address> {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(req.message);
  } catch {
    throw new AppError(400, AUTH_ERRORS.messageInvalid);
  }
  if (!parsed.nonce || !parsed.address || !parsed.issuedAt || !parsed.expirationTime) throw new AppError(400, AUTH_ERRORS.messageInvalid);

  // Consume the nonce before anything else so a failed attempt cannot be retried with the same message.
  const raw = await kv.getdel(nonceKey(parsed.nonce));
  if (!raw) throw new AppError(401, AUTH_ERRORS.nonceInvalid);
  const stored = storedNonceSchema.safeParse(JSON.parse(raw));
  if (!stored.success) throw new AppError(401, AUTH_ERRORS.nonceInvalid);

  if (parsed.domain !== req.domain || stored.data.domain !== req.domain || parsed.chainId !== req.chainId || stored.data.chainId !== req.chainId) {
    throw new AppError(401, AUTH_ERRORS.domainMismatch);
  }
  if (!isAddressEqual(parsed.address, getAddress(stored.data.address))) throw new AppError(401, AUTH_ERRORS.signatureInvalid);
  if (parsed.issuedAt.getTime() > req.now.getTime() + CLOCK_SKEW_MS) throw new AppError(401, AUTH_ERRORS.messageInvalid);
  if (!validateSiweMessage({ message: parsed, domain: req.domain, nonce: parsed.nonce, time: req.now })) throw new AppError(401, AUTH_ERRORS.nonceInvalid);

  let valid: boolean;
  try {
    valid = await client.verifyMessage({ address: parsed.address, message: req.message, signature: req.signature });
  } catch (error) {
    throw new AppError(503, COMMON_ERRORS.upstream, { cause: error });
  }
  if (!valid) throw new AppError(401, AUTH_ERRORS.signatureInvalid);
  return getAddress(parsed.address);
}
