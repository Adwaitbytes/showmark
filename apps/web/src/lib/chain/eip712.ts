import type { Address, TypedDataDomain } from "viem";
import { activeChainId } from "./chains";
import { addresses } from "./addresses";

export const PROOF_MODE = { rotating: 1, doorScansYou: 2 } as const;
export type ProofMode = (typeof PROOF_MODE)[keyof typeof PROOF_MODE];

export function registryDomain(verifyingContract: Address = addresses.registry): TypedDataDomain {
  return { name: "Showmark", version: "1", chainId: activeChainId, verifyingContract };
}

export const checkInTypes = {
  CheckIn: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
  ],
} as const;

export const doorPassTypes = {
  DoorPass: [
    { name: "eventId", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

export const doorAttestTypes = {
  DoorAttest: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
    { name: "attestedAt", type: "uint64" },
  ],
} as const;

export const linkWalletTypes = {
  LinkWallet: [
    { name: "pass", type: "address" },
    { name: "wallet", type: "address" },
    { name: "deadline", type: "uint64" },
  ],
} as const;
