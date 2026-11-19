import { hashTypedData, type Address, type Hex, type TypedData, type TypedDataDefinition } from "viem";
import { privateKeyToAddress, sign } from "viem/accounts";
import { checkInTypes, linkWalletTypes, PROOF_MODE, registryDomain, ticketTypes } from "@/lib/chain/eip712";
import { encodeAttendeeCode, type DoorPassPayload } from "@/lib/qr/payload";

// Signing straight from a private key with viem's tree-shakable hashTypedData and sign, instead of a
// viem account object, which also drags in transaction serializers the door route never uses.

/** The body of POST /api/relay/check-in: CheckInData with bigints as decimal strings. */
export interface CheckInRequest {
  eventId: string;
  attendee: Address;
  mode: 1;
  doorTime: string;
  /** The door's per-rotation ticket key, authorized inside DoorPass. */
  ticket: Address;
  attendeeSig: Hex;
  doorSig: Hex;
  /** Ticket(eventId, attendee) signed by the ticket key from the QR. */
  ticketSig: Hex;
}

/** EIP-712 signature by a raw private key, 65 bytes r || s || v, the same bytes a viem account produces. */
export function signTypedDataWithKey<const types extends TypedData | Record<string, unknown>, primaryType extends string>(
  privateKey: Hex,
  typedData: TypedDataDefinition<types, primaryType>,
): Promise<Hex> {
  return sign({ hash: hashTypedData(typedData), privateKey, to: "hex" });
}

function checkInSignature(passKey: Hex, eventId: bigint, mode: 1 | 2, verifyingContract?: Address): Promise<Hex> {
  return signTypedDataWithKey(passKey, {
    domain: registryDomain(verifyingContract),
    types: checkInTypes,
    primaryType: "CheckIn",
    message: { eventId, attendee: privateKeyToAddress(passKey), mode },
  });
}

/**
 * Mode 1: the pass signs CheckIn(eventId, attendee, 1) and the ticket key from the QR signs
 * Ticket(eventId, attendee), binding this rotation's door pass to this one attendee. The ticket key
 * is used here and dropped; only its signature travels (and waits in the outbox if the relay is down).
 */
export async function signCheckIn(passKey: Hex, door: DoorPassPayload, verifyingContract?: Address): Promise<CheckInRequest> {
  const attendee = privateKeyToAddress(passKey);
  const [attendeeSig, ticketSig] = await Promise.all([
    checkInSignature(passKey, door.eventId, PROOF_MODE.rotating, verifyingContract),
    signTypedDataWithKey(door.ticketKey, {
      domain: registryDomain(verifyingContract),
      types: ticketTypes,
      primaryType: "Ticket",
      message: { eventId: door.eventId, attendee },
    }),
  ]);
  return {
    eventId: door.eventId.toString(),
    attendee,
    mode: PROOF_MODE.rotating,
    doorTime: door.issuedAt.toString(),
    ticket: privateKeyToAddress(door.ticketKey),
    attendeeSig,
    doorSig: door.doorSig,
    ticketSig,
  };
}

/** The "door scans you" code (mode 2): CheckIn(eventId, attendee, 2), for the door app to attest. */
export async function attendeeCode(passKey: Hex, eventId: bigint, verifyingContract?: Address): Promise<string> {
  const attendeeSig = await checkInSignature(passKey, eventId, PROOF_MODE.doorScansYou, verifyingContract);
  return encodeAttendeeCode({ eventId, attendee: privateKeyToAddress(passKey), attendeeSig });
}

export interface LinkWalletMessage {
  pass: Address;
  wallet: Address;
  deadline: bigint;
}

/** The typed data both the pass and the wallet sign to link them (INTERFACES 2.2). */
export function linkWalletTypedData(message: LinkWalletMessage, verifyingContract?: Address) {
  return {
    domain: registryDomain(verifyingContract),
    types: linkWalletTypes,
    primaryType: "LinkWallet" as const,
    message,
  };
}

/** Ten minutes is long enough to approve in a wallet and short enough that a stray signature goes stale. */
export const LINK_DEADLINE_SECONDS = 600;

export function linkDeadline(nowMs: number): bigint {
  return BigInt(Math.floor(nowMs / 1000) + LINK_DEADLINE_SECONDS);
}

/** The deadline for a link signed now. */
export function linkDeadlineFromNow(): bigint {
  return linkDeadline(Date.now());
}
