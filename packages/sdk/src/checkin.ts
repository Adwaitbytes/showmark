import type { Address, Hex } from "viem";
import { nowSeconds, signCheckIn, signDoorAttest, signerAddress, type ShowmarkDomainParams, type ShowmarkSigner } from "./eip712";
import { ShowmarkInputError } from "./errors";
import { decodeAttendeeCode, decodeDoorPass, type AttendeeCodePayload, type DoorPassPayload } from "./qr";
import type { CheckInData } from "./relay";

// Builders that turn a scanned QR into the CheckInData the registry and the relayer accept.

function resolveDoorPass(doorPass: DoorPassPayload | string): DoorPassPayload {
  if (typeof doorPass !== "string") return doorPass;
  const decoded = decodeDoorPass(doorPass);
  if (!decoded) throw new ShowmarkInputError("This door code is not a valid Showmark door pass");
  return decoded;
}

/**
 * Mode 1, rotating door QR: the attendee scanned the door screen. Signs CheckIn with the attendee's pass key and
 * pairs it with the door's signature. `doorPass` may be the decoded payload, the bare token or the full URL.
 */
export async function buildDoorPassCheckIn(
  params: ShowmarkDomainParams & { doorPass: DoorPassPayload | string; signer: ShowmarkSigner },
): Promise<CheckInData> {
  const pass = resolveDoorPass(params.doorPass);
  const attendee: Address = signerAddress(params.signer);
  const attendeeSig: Hex = await signCheckIn({ ...params, eventId: pass.eventId, attendee });
  return { eventId: pass.eventId, attendee, mode: 1, doorTime: pass.issuedAt, attendeeSig, doorSig: pass.doorSig };
}

/**
 * Mode 2, door scans you: the door app scanned the attendee's SM2 code. Signs DoorAttest with the door key, bound
 * to that attendee. `attestedAt` defaults to now; the relayer accepts it until three days after the event ends.
 */
export async function buildDoorAttestCheckIn(
  params: ShowmarkDomainParams & { attendeeCode: AttendeeCodePayload | string; signer: ShowmarkSigner; attestedAt?: bigint },
): Promise<CheckInData> {
  const code = typeof params.attendeeCode === "string" ? decodeAttendeeCode(params.attendeeCode) : params.attendeeCode;
  if (!code) throw new ShowmarkInputError("This attendee code is not a valid Showmark code");
  const attestedAt = params.attestedAt ?? nowSeconds();
  const doorSig = await signDoorAttest({ ...params, eventId: code.eventId, attendee: code.attendee, attestedAt });
  return { eventId: code.eventId, attendee: code.attendee, mode: 2, doorTime: attestedAt, attendeeSig: code.attendeeSig, doorSig };
}
