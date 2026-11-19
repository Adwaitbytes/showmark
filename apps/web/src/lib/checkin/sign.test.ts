import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkInTypes, doorPassTypes, registryDomain, ticketTypes } from "@/lib/chain/eip712";
import { decodeAttendeeCode, decodeDoorPass, doorPassUrl } from "@/lib/qr/payload";
import { attendeeCode, linkDeadline, linkWalletTypedData, signCheckIn, signTypedDataWithKey } from "./sign";

const REGISTRY: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OTHER_REGISTRY: Address = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

async function doorPass(eventId: bigint, issuedAt: bigint) {
  const door = privateKeyToAccount(generatePrivateKey());
  const ticketKey = generatePrivateKey();
  const ticket = privateKeyToAccount(ticketKey).address;
  const doorSig = await door.signTypedData({
    domain: registryDomain(REGISTRY),
    types: doorPassTypes,
    primaryType: "DoorPass",
    message: { eventId, issuedAt, ticket },
  });
  const decoded = decodeDoorPass(doorPassUrl("https://showmark.example", { eventId, issuedAt, doorSig, ticketKey }));
  if (!decoded) throw new Error("door pass did not round-trip");
  return { decoded, ticket, ticketKey };
}

const checkIn = (eventId: bigint, attendee: Address, mode: number) => ({
  domain: registryDomain(REGISTRY),
  types: checkInTypes,
  primaryType: "CheckIn" as const,
  message: { eventId, attendee, mode },
});

describe("signCheckIn", () => {
  it("signs CheckIn(eventId, attendee, 1) with the pass for the registry domain", async () => {
    const passKey = generatePrivateKey();
    const pass = privateKeyToAccount(passKey).address;
    const { decoded, ticket } = await doorPass(7n, 1_764_245_000n);
    const request = await signCheckIn(passKey, decoded, REGISTRY);

    expect(request).toMatchObject({ eventId: "7", attendee: pass, mode: 1, doorTime: "1764245000", doorSig: decoded.doorSig, ticket });
    expect(await recoverTypedDataAddress({ ...checkIn(7n, pass, 1), signature: request.attendeeSig })).toBe(pass);
  });

  it("signs Ticket(eventId, attendee) with the ticket key from the QR and sends only its address", async () => {
    const passKey = generatePrivateKey();
    const pass = privateKeyToAccount(passKey).address;
    const { decoded, ticket, ticketKey } = await doorPass(7n, 1n);
    const request = await signCheckIn(passKey, decoded, REGISTRY);

    const signer = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: ticketTypes,
      primaryType: "Ticket",
      message: { eventId: 7n, attendee: pass },
      signature: request.ticketSig,
    });
    expect(signer).toBe(ticket);
    expect(JSON.stringify(request)).not.toContain(ticketKey.slice(2));
  });

  it("matches the bytes a viem account produces", async () => {
    const passKey = generatePrivateKey();
    const account = privateKeyToAccount(passKey);
    const typed = checkIn(3n, account.address, 1);
    expect(await signTypedDataWithKey(passKey, typed)).toBe(await account.signTypedData(typed));
  });

  it("binds the signature to the registry, the event and the mode", async () => {
    const passKey = generatePrivateKey();
    const pass = privateKeyToAccount(passKey).address;
    const { decoded } = await doorPass(7n, 1n);
    const { attendeeSig } = await signCheckIn(passKey, decoded, REGISTRY);

    const otherContract = await recoverTypedDataAddress({ ...checkIn(7n, pass, 1), domain: registryDomain(OTHER_REGISTRY), signature: attendeeSig });
    const otherEvent = await recoverTypedDataAddress({ ...checkIn(8n, pass, 1), signature: attendeeSig });
    const otherMode = await recoverTypedDataAddress({ ...checkIn(7n, pass, 2), signature: attendeeSig });
    expect([otherContract, otherEvent, otherMode]).not.toContain(pass);
  });

  it("sends 65 byte signatures in the shape the relay schema accepts", async () => {
    const { decoded } = await doorPass(1n, 2n);
    const request = await signCheckIn(generatePrivateKey(), decoded, REGISTRY);
    for (const sig of [request.attendeeSig, request.doorSig, request.ticketSig]) expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});

describe("attendeeCode", () => {
  it("signs mode 2, so a door-scans-you code cannot be replayed as a door QR check-in", async () => {
    const passKey = generatePrivateKey();
    const pass = privateKeyToAccount(passKey).address;
    const decoded = decodeAttendeeCode(await attendeeCode(passKey, 42n, REGISTRY));
    expect(decoded?.eventId).toBe(42n);
    expect(decoded?.attendee).toBe(pass);
    expect(await recoverTypedDataAddress({ ...checkIn(42n, pass, 2), signature: decoded!.attendeeSig })).toBe(pass);
    expect(await recoverTypedDataAddress({ ...checkIn(42n, pass, 1), signature: decoded!.attendeeSig })).not.toBe(pass);
  });
});

describe("linkWalletTypedData", () => {
  it("lets the pass sign LinkWallet with a deadline ten minutes out", async () => {
    const pass = privateKeyToAccount(generatePrivateKey());
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    const deadline = linkDeadline(1_700_000_000_000);
    expect(deadline).toBe(1_700_000_600n);
    const typed = linkWalletTypedData({ pass: pass.address, wallet, deadline }, REGISTRY);
    const signature = await pass.signTypedData(typed);
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(pass.address);
  });
});
