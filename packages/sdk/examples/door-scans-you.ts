// Mode 2, door scans you: the attendee shows a code, the door app scans it and attests. The attestation is bound
// to that attendee, so it cannot be forwarded to someone outside.  Run: node examples/door-scans-you.ts
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildDoorAttestCheckIn, createAttendeeCode, decodeAttendeeCode, encodeAttendeeCode } from "@showmark/sdk";

// Placeholder registry for the demo. Set SHOWMARK_REGISTRY to the deployed ShowmarkRegistry (see docs/SDK.md).
const registry = getAddress(process.env.SHOWMARK_REGISTRY ?? "0x5157000000000000000000000000000000000001");
const domain = { chainId: 1983, registry };

const doorKey = privateKeyToAccount(generatePrivateKey());
const passKey = privateKeyToAccount(generatePrivateKey());

// Attendee phone: sign CheckIn and show it as an SM2 code.
const code = encodeAttendeeCode(await createAttendeeCode({ ...domain, signer: passKey, eventId: 42n }));
console.log("attendee code", code);

// Door app: scan, decode, attest. Works offline; queue the result and send it later with relayCheckInBatch.
const scanned = decodeAttendeeCode(code);
if (!scanned) throw new Error("not a Showmark attendee code");
const checkIn = await buildDoorAttestCheckIn({ ...domain, attendeeCode: scanned, signer: doorKey });
console.log("mode", checkIn.mode, "attendee", checkIn.attendee, "attestedAt", checkIn.doorTime.toString());
