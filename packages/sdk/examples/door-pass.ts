// Mode 1, rotating door QR, without a chain: the door signs a pass, the attendee's phone decodes it and builds
// the check-in the relayer accepts.  Run: node examples/door-pass.ts
import { getAddress, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildDoorPassCheckIn, createDoorPass, decodeDoorPass, doorPassTypedData, doorPassUrl } from "@showmark/sdk";

// Signatures are only valid for one registry and chain id.
// Placeholder registry for the demo. Set SHOWMARK_REGISTRY to the deployed ShowmarkRegistry (see docs/SDK.md).
const registry = getAddress(process.env.SHOWMARK_REGISTRY ?? "0x5157000000000000000000000000000000000001");
const domain = { chainId: 1983, registry };

const doorKey = privateKeyToAccount(generatePrivateKey()); // authorized on-chain by the organizer
const passKey = privateKeyToAccount(generatePrivateKey()); // the attendee's guest pass, kept on the phone

// Door screen: sign DoorPass(eventId, issuedAt) and show it as a URL in a QR code. Repeat every 15 seconds.
const pass = await createDoorPass({ ...domain, signer: doorKey, eventId: 42n });
const url = doorPassUrl("https://showmark.app", pass);
console.log("door QR      ", url);

// Attendee phone: the camera opens the URL. Decoding never throws; it returns null for anything malformed.
const scanned = decodeDoorPass(url);
if (!scanned) throw new Error("not a Showmark door pass");
// The door signed the address of this rotation's ticket key; the key itself only ever lives in the QR.
const ticket = privateKeyToAccount(scanned.ticketKey).address;
const signer = await recoverTypedDataAddress({ ...doorPassTypedData(domain, { ...scanned, ticket }), signature: scanned.doorSig });
console.log("signed by door", signer === doorKey.address);

// Sign CheckIn(mode 1) with the pass key and Ticket with the ticket key, then pair both with the door signature.
// This is the body of POST /api/relay/check-in. It holds the ticket signature, never the ticket key.
const checkIn = await buildDoorPassCheckIn({ ...domain, doorPass: scanned, signer: passKey });
console.log("relay body   ", JSON.stringify(checkIn, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
