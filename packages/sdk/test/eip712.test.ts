import {
  concat,
  createWalletClient,
  custom,
  encodeAbiParameters,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  ShowmarkInputError,
  ShowmarkSigningError,
  checkInTypedData,
  createAttendeeCode,
  createDoorPass,
  doorPassTypedData,
  hashCheckIn,
  hashDoorAttest,
  hashDoorPass,
  hashLinkWallet,
  hashTicket,
  signCheckIn,
  signDoorAttest,
  signDoorPass,
  signLinkWallet,
  signTicket,
} from "@showmark/sdk";
import fixture from "./fixtures/eip712-digests.json";

// The fixture is written by test/foundry/script/Digests.s.sol (pnpm digests): digests computed in the EVM with
// abi.encode and keccak256, and signatures from Foundry's vm.sign. The keys are derived from public labels.
const attendeeAccount = privateKeyToAccount(keccak256(toBytes("showmark sdk fixture attendee")));
const doorAccount = privateKeyToAccount(keccak256(toBytes("showmark sdk fixture door")));
const walletAccount = privateKeyToAccount(keccak256(toBytes("showmark sdk fixture wallet")));
const ticketKey = keccak256(toBytes("showmark sdk fixture ticket"));
const ticketAccount = privateKeyToAccount(ticketKey);
const registry = fixture.verifyingContract as Address;

function accountFor(address: string) {
  for (const a of [attendeeAccount, doorAccount, walletAccount, ticketAccount]) if (a.address === address) return a;
  throw new Error(`No fixture key for ${address}`);
}

// An implementation of EIP-712 written straight from the spec, sharing no code with viem's hashTypedData.
const manual = {
  domainSeparator(chainId: number, verifyingContract: Address): Hex {
    return keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [
          keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
          keccak256(toBytes("Showmark")),
          keccak256(toBytes("1")),
          BigInt(chainId),
          verifyingContract,
        ],
      ),
    );
  },
  digest(chainId: number, structHash: Hex): Hex {
    return keccak256(concat(["0x1901", manual.domainSeparator(chainId, registry), structHash]));
  },
  checkIn(chainId: number, eventId: bigint, attendee: Address, mode: number): Hex {
    return manual.digest(
      chainId,
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint8" }],
          [keccak256(toBytes("CheckIn(uint256 eventId,address attendee,uint8 mode)")), eventId, attendee, mode],
        ),
      ),
    );
  },
  doorPass(chainId: number, eventId: bigint, issuedAt: bigint, ticket: Address): Hex {
    return manual.digest(
      chainId,
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }, { type: "address" }],
          [keccak256(toBytes("DoorPass(uint256 eventId,uint64 issuedAt,address ticket)")), eventId, issuedAt, ticket],
        ),
      ),
    );
  },
  ticket(chainId: number, eventId: bigint, attendee: Address): Hex {
    return manual.digest(
      chainId,
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
          [keccak256(toBytes("Ticket(uint256 eventId,address attendee)")), eventId, attendee],
        ),
      ),
    );
  },
  doorAttest(chainId: number, eventId: bigint, attendee: Address, attestedAt: bigint): Hex {
    return manual.digest(
      chainId,
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint64" }],
          [keccak256(toBytes("DoorAttest(uint256 eventId,address attendee,uint64 attestedAt)")), eventId, attendee, attestedAt],
        ),
      ),
    );
  },
  linkWallet(chainId: number, pass: Address, wallet: Address, deadline: bigint): Hex {
    return manual.digest(
      chainId,
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint64" }],
          [keccak256(toBytes("LinkWallet(address pass,address wallet,uint64 deadline)")), pass, wallet, deadline],
        ),
      ),
    );
  },
};

describe.each(fixture.chains)("EIP-712 on chain $chainId matches the Solidity harness", (chain) => {
  const domain = { chainId: chain.chainId, registry };

  it("derives the same fixture addresses from the labelled keys", () => {
    expect(attendeeAccount.address).toBe(chain.attendee);
    expect(doorAccount.address).toBe(chain.door);
    expect(walletAccount.address).toBe(chain.wallet);
    expect(ticketAccount.address).toBe(chain.ticketAddress);
  });

  it("has the same domain separator in the manual implementation", () => {
    expect(manual.domainSeparator(chain.chainId, registry)).toBe(chain.domainSeparator);
  });

  it.each(chain.checkIn)("CheckIn($eventId, $attendee, $mode)", async (c) => {
    const eventId = BigInt(c.eventId);
    const attendee = c.attendee as Address;
    expect(manual.checkIn(chain.chainId, eventId, attendee, c.mode)).toBe(c.digest);
    if (c.mode !== 1 && c.mode !== 2) {
      // The contract hashes any uint8; the SDK refuses to sign a mode the registry would reject.
      expect(() => hashCheckIn(domain, { eventId, attendee, mode: c.mode as 1 })).toThrow(ShowmarkInputError);
      return;
    }
    const mode = c.mode;
    expect(hashCheckIn(domain, { eventId, attendee, mode })).toBe(c.digest);
    if (c.signature) expect(await signCheckIn({ ...domain, signer: attendeeAccount, eventId, mode })).toBe(c.signature);
  });

  it.each(chain.doorPass)("DoorPass($eventId, $issuedAt, $ticket)", async (c) => {
    const message = { eventId: BigInt(c.eventId), issuedAt: BigInt(c.issuedAt), ticket: c.ticket as Address };
    expect(hashDoorPass(domain, message)).toBe(c.digest);
    expect(manual.doorPass(chain.chainId, message.eventId, message.issuedAt, message.ticket)).toBe(c.digest);
    if (c.signature) expect(await signDoorPass({ ...domain, ...message, signer: doorAccount })).toBe(c.signature);
  });

  it.each(chain.ticket)("Ticket($eventId, $attendee)", async (c) => {
    const message = { eventId: BigInt(c.eventId), attendee: c.attendee as Address };
    expect(hashTicket(domain, message)).toBe(c.digest);
    expect(manual.ticket(chain.chainId, message.eventId, message.attendee)).toBe(c.digest);
    if (c.signature) expect(await signTicket({ ...domain, ...message, signer: ticketAccount })).toBe(c.signature);
  });

  it("signs the fixture door pass through createDoorPass with the fixture ticket key", async () => {
    const c = chain.doorPass[0];
    if (!c?.signature) throw new Error("fixture lost its signed door pass");
    const pass = await createDoorPass({ ...domain, signer: doorAccount, eventId: 42n, issuedAt: BigInt(c.issuedAt), ticketKey });
    expect(pass.doorSig).toBe(c.signature);
    expect(pass.ticketKey).toBe(ticketKey);
  });

  it.each(chain.doorAttest)("DoorAttest($eventId, $attendee, $attestedAt)", async (c) => {
    const message = { eventId: BigInt(c.eventId), attendee: c.attendee as Address, attestedAt: BigInt(c.attestedAt) };
    expect(hashDoorAttest(domain, message)).toBe(c.digest);
    expect(manual.doorAttest(chain.chainId, message.eventId, message.attendee, message.attestedAt)).toBe(c.digest);
    if (c.signature) expect(await signDoorAttest({ ...domain, ...message, signer: doorAccount })).toBe(c.signature);
  });

  it.each(chain.linkWallet)("LinkWallet signed by $signer", async (c) => {
    const message = { pass: c.pass as Address, wallet: c.wallet as Address, deadline: BigInt(c.deadline) };
    expect(hashLinkWallet(domain, message)).toBe(c.digest);
    expect(manual.linkWallet(chain.chainId, message.pass, message.wallet, message.deadline)).toBe(c.digest);
    expect(await signLinkWallet({ ...domain, ...message, signer: accountFor(c.signer) })).toBe(c.signature);
  });
});

describe("signers", () => {
  const domain = { chainId: 1983, registry };

  it("signs through a wallet client whose account lives behind EIP-1193", async () => {
    const wallet = createWalletClient({
      account: attendeeAccount.address,
      transport: custom({
        async request({ method, params }: { method: string; params?: unknown }) {
          if (method !== "eth_signTypedData_v4") throw new Error(`unexpected ${method}`);
          const [, json] = params as [string, string];
          const typed = JSON.parse(json) as { message: { eventId: string; attendee: Address; mode: number } };
          return attendeeAccount.signTypedData(
            checkInTypedData(domain, { eventId: BigInt(typed.message.eventId), attendee: typed.message.attendee, mode: typed.message.mode as 1 }),
          );
        },
      }),
    });
    const viaWallet = await signCheckIn({ ...domain, signer: wallet, eventId: 7n, mode: 1 });
    const direct = await signCheckIn({ ...domain, signer: attendeeAccount, eventId: 7n, mode: 1 });
    expect(viaWallet).toBe(direct);
  });

  it("wraps a refused signature in ShowmarkSigningError", async () => {
    const wallet = createWalletClient({
      account: attendeeAccount.address,
      transport: custom({
        async request() {
          throw new Error("User rejected the request");
        },
      }),
    });
    await expect(signCheckIn({ ...domain, signer: wallet, eventId: 1n, mode: 1 })).rejects.toBeInstanceOf(ShowmarkSigningError);
  });

  it("creates a door pass the door key provably signed, over a fresh ticket key each time", async () => {
    const pass = await createDoorPass({ ...domain, signer: doorAccount, eventId: 42n, issuedAt: 1795073006n });
    const ticket = privateKeyToAccount(pass.ticketKey).address;
    const signer = await recoverTypedDataAddress({
      ...doorPassTypedData(domain, { ...pass, ticket }),
      signature: pass.doorSig,
    });
    expect(signer).toBe(doorAccount.address);
    const next = await createDoorPass({ ...domain, signer: doorAccount, eventId: 42n, issuedAt: 1795073006n });
    expect(next.ticketKey).not.toBe(pass.ticketKey);
  });

  it("defaults issuedAt to the current second", async () => {
    const before = BigInt(Math.floor(Date.now() / 1000));
    const pass = await createDoorPass({ ...domain, signer: doorAccount, eventId: 1n });
    expect(pass.issuedAt >= before && pass.issuedAt <= before + 2n).toBe(true);
  });

  it("creates an attendee code bound to the signer", async () => {
    const code = await createAttendeeCode({ ...domain, signer: attendeeAccount, eventId: 9n });
    expect(code.attendee).toBe(attendeeAccount.address);
    const signer = await recoverTypedDataAddress({
      ...checkInTypedData(domain, { ...code, mode: 2 }),
      signature: code.attendeeSig,
    });
    expect(signer).toBe(attendeeAccount.address);
  });
});

describe("input validation", () => {
  const domain = { chainId: 1983, registry };

  it("rejects out-of-range integers and bad addresses before signing", () => {
    expect(() => hashCheckIn(domain, { eventId: -1n, attendee: attendeeAccount.address, mode: 1 })).toThrow(ShowmarkInputError);
    expect(() => hashDoorPass(domain, { eventId: 1n, issuedAt: 2n ** 64n, ticket: attendeeAccount.address })).toThrow(ShowmarkInputError);
    expect(() => hashCheckIn(domain, { eventId: 1n, attendee: "0x1234", mode: 1 })).toThrow(ShowmarkInputError);
    expect(() => hashCheckIn({ chainId: 0, registry }, { eventId: 1n, attendee: attendeeAccount.address, mode: 1 })).toThrow(ShowmarkInputError);
    expect(() => hashCheckIn({ chainId: 1983, registry: "0xnope" }, { eventId: 1n, attendee: attendeeAccount.address, mode: 1 })).toThrow(
      ShowmarkInputError,
    );
  });

  it("checksums lowercase addresses and rejects a wrong checksum as a typo", async () => {
    const lower = attendeeAccount.address.toLowerCase() as Address;
    expect(hashCheckIn({ chainId: 1983, registry: registry.toLowerCase() as Address }, { eventId: 1n, attendee: lower, mode: 1 })).toBe(
      hashCheckIn(domain, { eventId: 1n, attendee: attendeeAccount.address, mode: 1 }),
    );
    const badChecksum = attendeeAccount.address.replace(/[a-f]/, (c) => c.toUpperCase()) as Address;
    expect(() => hashCheckIn(domain, { eventId: 1n, attendee: badChecksum, mode: 1 })).toThrow(ShowmarkInputError);
    await expect(signCheckIn({ chainId: 1983, registry: badChecksum, signer: attendeeAccount, eventId: 1n, mode: 1 })).rejects.toBeInstanceOf(ShowmarkInputError);
  });

  it("binds signatures to the chain and the registry", () => {
    const message = { eventId: 42n, attendee: attendeeAccount.address, mode: 1 as const };
    const base = hashCheckIn(domain, message);
    expect(hashCheckIn(domain, { ...message, mode: 2 })).not.toBe(base);
    expect(hashCheckIn({ ...domain, chainId: 1990 }, message)).not.toBe(base);
    expect(hashCheckIn({ ...domain, registry: walletAccount.address }, message)).not.toBe(base);
    expect(hashCheckIn(domain, { ...message, eventId: 43n })).not.toBe(base);
  });
});
