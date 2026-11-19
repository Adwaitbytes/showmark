import type { Address, Hex, LocalAccount } from "viem";
import { doorAttestTypes, doorPassTypes, PROOF_MODE, registryDomain } from "@/lib/chain/eip712";
import type { AttendeeCodePayload, DoorPassPayload } from "@/lib/qr/payload";

// Everything a door key signs. Both types are verified on-chain against the registry's EIP-712 domain, so the domain
// (chain id and registry address) must be exactly the one the registry uses.

/** A mode 2 check-in ready for /api/relay/check-in, in the wire format: bigints as decimal strings. */
export interface SignedAttestation {
  eventId: string;
  attendee: Address;
  mode: 2;
  doorTime: string;
  attendeeSig: Hex;
  doorSig: Hex;
}

/** Signs DoorPass(eventId, issuedAt) for the rotating door QR (mode 1). */
export async function signDoorPass(
  doorKey: LocalAccount,
  eventId: bigint,
  issuedAt: bigint,
  registry: Address,
): Promise<DoorPassPayload> {
  const doorSig = await doorKey.signTypedData({
    domain: registryDomain(registry),
    types: doorPassTypes,
    primaryType: "DoorPass",
    message: { eventId, issuedAt },
  });
  return { eventId, issuedAt, doorSig };
}

/** Signs DoorAttest(eventId, attendee, attestedAt) for a scanned attendee code (mode 2, door scans you). */
export async function signDoorAttest(
  doorKey: LocalAccount,
  code: AttendeeCodePayload,
  attestedAt: bigint,
  registry: Address,
): Promise<SignedAttestation> {
  const doorSig = await doorKey.signTypedData({
    domain: registryDomain(registry),
    types: doorAttestTypes,
    primaryType: "DoorAttest",
    message: { eventId: code.eventId, attendee: code.attendee, attestedAt },
  });
  return {
    eventId: code.eventId.toString(),
    attendee: code.attendee,
    mode: PROOF_MODE.doorScansYou,
    doorTime: attestedAt.toString(),
    attendeeSig: code.attendeeSig,
    doorSig,
  };
}
