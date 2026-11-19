import { zeroAddress, type Address, type Hex, type LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { doorAttestTypes, doorPassTypes, PROOF_MODE, registryDomain } from "@/lib/chain/eip712";
import type { AttendeeCodePayload, DoorPassPayload } from "@/lib/qr/payload";

// Everything a door key signs. Both types are verified on-chain against the registry's EIP-712 domain, so the domain
// (chain id and registry address) must be exactly the one the registry uses.
//
// Mode 1 (audit C-01): each rotation gets a fresh throwaway ticket key. The door key signs the ticket's address inside
// DoorPass, and the ticket's private key travels only inside the QR, so an attendee must have seen the screen to sign a
// Ticket over their own address. The ticket key lives in memory for one rotation and is never stored or logged.

/** A mode 2 check-in ready for /api/relay/check-in, in the wire format: bigints as decimal strings. */
export interface SignedAttestation {
  eventId: string;
  attendee: Address;
  mode: 2;
  doorTime: string;
  /** Mode 2 has no ticket: the zero address and an empty signature. */
  ticket: Address;
  attendeeSig: Hex;
  doorSig: Hex;
  ticketSig: Hex;
}

/**
 * Makes one rotation's door pass (mode 1): a fresh ticket key, and DoorPass(eventId, issuedAt, ticket) signed by the
 * door key, where ticket is that key's address. The returned payload carries the ticket private key for the QR only.
 */
export async function signDoorPass(
  doorKey: LocalAccount,
  eventId: bigint,
  issuedAt: bigint,
  registry: Address,
  generateTicketKey: () => Hex = generatePrivateKey,
): Promise<DoorPassPayload> {
  const ticketKey = generateTicketKey();
  const ticket = privateKeyToAccount(ticketKey).address;
  const doorSig = await doorKey.signTypedData({
    domain: registryDomain(registry),
    types: doorPassTypes,
    primaryType: "DoorPass",
    message: { eventId, issuedAt, ticket },
  });
  return { eventId, issuedAt, doorSig, ticketKey };
}

/**
 * Signs DoorAttest(eventId, attendee, attestedAt) for a scanned attendee code (mode 2, door scans you). The attendee
 * code carries CheckIn(eventId, attendee, 2), so a mode 2 code cannot be replayed as mode 1.
 */
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
    ticket: zeroAddress,
    attendeeSig: code.attendeeSig,
    doorSig,
    ticketSig: "0x",
  };
}
