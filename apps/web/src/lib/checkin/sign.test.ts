import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkInTypes, doorPassTypes, registryDomain } from "@/lib/chain/eip712";
import { decodeAttendeeCode, decodeDoorPass, doorPassUrl } from "@/lib/qr/payload";
import { attendeeCode, linkDeadline, linkWalletTypedData, signCheckIn } from "./sign";

const REGISTRY: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OTHER_REGISTRY: Address = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

async function doorPass(eventId: bigint, issuedAt: bigint) {
  const door = privateKeyToAccount(generatePrivateKey());
  const doorSig = await door.signTypedData({
    domain: registryDomain(REGISTRY),
    types: doorPassTypes,
    primaryType: "DoorPass",
    message: { eventId, issuedAt },
  });
  const decoded = decodeDoorPass(doorPassUrl("https://showmark.example", { eventId, issuedAt, doorSig }));
  if (!decoded) throw new Error("door pass did not round-trip");
  return { door, decoded };
}

describe("signCheckIn", () => {
  it("produces a CheckIn signature that recovers to the pass for the registry domain", async () => {
    const pass = privateKeyToAccount(generatePrivateKey());
    const { decoded } = await doorPass(7n, 1_764_245_000n);
    const request = await signCheckIn(pass, decoded, REGISTRY);

    expect(request).toMatchObject({ eventId: "7", attendee: pass.address, mode: 1, doorTime: "1764245000", doorSig: decoded.doorSig });
    const recovered = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: checkInTypes,
      primaryType: "CheckIn",
      message: { eventId: 7n, attendee: pass.address },
      signature: request.attendeeSig,
    });
    expect(recovered).toBe(pass.address);
  });

  it("binds the signature to the registry, so it does not verify against another contract or event", async () => {
    const pass = privateKeyToAccount(generatePrivateKey());
    const { decoded } = await doorPass(7n, 1n);
    const { attendeeSig } = await signCheckIn(pass, decoded, REGISTRY);

    const otherContract = await recoverTypedDataAddress({
      domain: registryDomain(OTHER_REGISTRY),
      types: checkInTypes,
      primaryType: "CheckIn",
      message: { eventId: 7n, attendee: pass.address },
      signature: attendeeSig,
    });
    const otherEvent = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: checkInTypes,
      primaryType: "CheckIn",
      message: { eventId: 8n, attendee: pass.address },
      signature: attendeeSig,
    });
    expect(otherContract).not.toBe(pass.address);
    expect(otherEvent).not.toBe(pass.address);
  });

  it("sends 65 byte signatures in the shape the relay schema accepts", async () => {
    const pass = privateKeyToAccount(generatePrivateKey());
    const { decoded } = await doorPass(1n, 2n);
    const request = await signCheckIn(pass, decoded, REGISTRY);
    expect(request.attendeeSig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(request.doorSig).toMatch(/^0x[0-9a-f]{130}$/);
  });
});

describe("attendeeCode", () => {
  it("encodes a door-scans-you code whose signature recovers to the pass", async () => {
    const pass = privateKeyToAccount(generatePrivateKey());
    const code = await attendeeCode(pass, 42n, REGISTRY);
    const decoded = decodeAttendeeCode(code);
    expect(decoded?.eventId).toBe(42n);
    expect(decoded?.attendee).toBe(pass.address);
    const recovered = await recoverTypedDataAddress({
      domain: registryDomain(REGISTRY),
      types: checkInTypes,
      primaryType: "CheckIn",
      message: { eventId: 42n, attendee: pass.address },
      signature: decoded!.attendeeSig,
    });
    expect(recovered).toBe(pass.address);
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
