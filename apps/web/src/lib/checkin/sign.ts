import type { Address, Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { checkInTypes, linkWalletTypes, PROOF_MODE, registryDomain } from "@/lib/chain/eip712";
import { encodeAttendeeCode, type DoorPassPayload } from "@/lib/qr/payload";

/** The body of POST /api/relay/check-in: CheckInData with bigints as decimal strings. */
export interface CheckInRequest {
  eventId: string;
  attendee: Address;
  mode: 1;
  doorTime: string;
  attendeeSig: Hex;
  doorSig: Hex;
}

function checkInSignature(pass: PrivateKeyAccount, eventId: bigint, verifyingContract?: Address): Promise<Hex> {
  return pass.signTypedData({
    domain: registryDomain(verifyingContract),
    types: checkInTypes,
    primaryType: "CheckIn",
    message: { eventId, attendee: pass.address },
  });
}

/** Signs CheckIn(eventId, attendee) with the pass and pairs it with the door's signed pass (mode 1). */
export async function signCheckIn(pass: PrivateKeyAccount, door: DoorPassPayload, verifyingContract?: Address): Promise<CheckInRequest> {
  const attendeeSig = await checkInSignature(pass, door.eventId, verifyingContract);
  return {
    eventId: door.eventId.toString(),
    attendee: pass.address,
    mode: PROOF_MODE.rotating,
    doorTime: door.issuedAt.toString(),
    attendeeSig,
    doorSig: door.doorSig,
  };
}

/** The "door scans you" code (mode 2): the same CheckIn signature, for the door app to attest. */
export async function attendeeCode(pass: PrivateKeyAccount, eventId: bigint, verifyingContract?: Address): Promise<string> {
  const attendeeSig = await checkInSignature(pass, eventId, verifyingContract);
  return encodeAttendeeCode({ eventId, attendee: pass.address, attendeeSig });
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
