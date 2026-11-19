import type { Address } from "viem";

// The sign-in message, in the EIP-4361 (Sign-In with Ethereum) format the auth routes verify. It names the site, the
// chain and a one-time nonce from /api/auth/nonce, so a signature cannot be replayed on another site or later.

export interface SignInMessageInput {
  domain: string;
  origin: string;
  address: Address;
  chainId: number;
  nonce: string;
  issuedAt: Date;
}

export const SIGN_IN_STATEMENT = "Sign in to the Showmark organizer console. This does not send a transaction or cost anything.";

export function signInMessage(input: SignInMessageInput): string {
  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.address,
    "",
    SIGN_IN_STATEMENT,
    "",
    `URI: ${input.origin}`,
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
  ].join("\n");
}
