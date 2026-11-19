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
  signCheckIn,
  signDoorAttest,
  signDoorPass,
  signLinkWallet,
} from "@showmark/sdk";
import fixture from "./fixtures/eip712-digests.json";

// The fixture is written by test/foundry/script/Digests.s.sol (pnpm digests): digests computed in the EVM with
// abi.encode and keccak256, and signatures from Foundry's vm.sign. The keys are derived from public labels.
const attendeeAccount = privateKeyToAccount(keccak256(toBytes("showmark sdk fixture attendee")));
const doorAccount = privateKeyToAccount(keccak256(toBytes("showmark sdk fixture door")));
const walletAccount = privateKeyToAccount(keccak256(toBytes("showmark sdk fixture wallet")));
const registry = fixture.verifyingContract as Address;

function accountFor(address: string) {
  for (const a of [attendeeAccount, doorAccount, walletAccount]) if (a.address === address) return a;
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
  checkIn(chainId: number, eventId: bigint, attendee: Address): Hex {
    return manual.digest(
      chainId,
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
          [keccak256(toBytes("CheckIn(uint256 eventId,address attendee)")), eventId, attendee],
        ),
      ),
    );
  },
  doorPass(chainId: number, eventId: bigint, issuedAt: bigint): Hex {
    return manual.digest(
      chainId,
      keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
          [keccak256(toBytes("DoorPass(uint256 eventId,uint64 issuedAt)")), eventId, issuedAt],
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
  });

  it("has the same domain separator in the manual implementation", () => {
    expect(manual.domainSeparator(chain.chainId, registry)).toBe(chain.domainSeparator);
  });

  it.each(chain.checkIn)("CheckIn($eventId, $attendee)", async (c) => {
    const message = { eventId: BigInt(c.eventId), attendee: c.attendee as Address };
    expect(hashCheckIn(domain, message)).toBe(c.digest);
    expect(manual.checkIn(chain.chainId, message.eventId, message.attendee)).toBe(c.digest);
    if (c.signature) {
      expect(await signCheckIn({ ...domain, signer: attendeeAccount, eventId: message.eventId })).toBe(c.signature);
    }
  });

  it.each(chain.doorPass)("DoorPass($eventId, $issuedAt)", async (c) => {
    const message = { eventId: BigInt(c.eventId), issuedAt: BigInt(c.issuedAt) };
    expect(hashDoorPass(domain, message)).toBe(c.digest);
    expect(manual.doorPass(chain.chainId, message.eventId, message.issuedAt)).toBe(c.digest);
    if (c.signature) expect(await signDoorPass({ ...domain, ...message, signer: doorAccount })).toBe(c.signature);
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
          const typed = JSON.parse(json) as { message: { eventId: string; attendee: Address } };
          return attendeeAccount.signTypedData(
            checkInTypedData(domain, { eventId: BigInt(typed.message.eventId), attendee: typed.message.attendee }),
          );
        },
      }),
    });
    const viaWallet = await signCheckIn({ ...domain, signer: wallet, eventId: 7n });
    const direct = await signCheckIn({ ...domain, signer: attendeeAccount, eventId: 7n });
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
    await expect(signCheckIn({ ...domain, signer: wallet, eventId: 1n })).rejects.toBeInstanceOf(ShowmarkSigningError);
  });

  it("creates a door pass the door key provably signed", async () => {
    const pass = await createDoorPass({ ...domain, signer: doorAccount, eventId: 42n, issuedAt: 1795073006n });
    const signer = await recoverTypedDataAddress({
      ...doorPassTypedData(domain, pass),
      signature: pass.doorSig,
    });
    expect(signer).toBe(doorAccount.address);
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
      ...checkInTypedData(domain, code),
      signature: code.attendeeSig,
    });
    expect(signer).toBe(attendeeAccount.address);
  });
});

describe("input validation", () => {
  const domain = { chainId: 1983, registry };

  it("rejects out-of-range integers and bad addresses before signing", () => {
    expect(() => hashCheckIn(domain, { eventId: -1n, attendee: attendeeAccount.address })).toThrow(ShowmarkInputError);
    expect(() => hashDoorPass(domain, { eventId: 1n, issuedAt: 2n ** 64n })).toThrow(ShowmarkInputError);
    expect(() => hashCheckIn(domain, { eventId: 1n, attendee: "0x1234" })).toThrow(ShowmarkInputError);
    expect(() => hashCheckIn({ chainId: 0, registry }, { eventId: 1n, attendee: attendeeAccount.address })).toThrow(ShowmarkInputError);
    expect(() => hashCheckIn({ chainId: 1983, registry: "0xnope" }, { eventId: 1n, attendee: attendeeAccount.address })).toThrow(
      ShowmarkInputError,
    );
  });

  it("binds signatures to the chain and the registry", () => {
    const message = { eventId: 42n, attendee: attendeeAccount.address };
    const base = hashCheckIn(domain, message);
    expect(hashCheckIn({ ...domain, chainId: 1990 }, message)).not.toBe(base);
    expect(hashCheckIn({ ...domain, registry: walletAccount.address }, message)).not.toBe(base);
    expect(hashCheckIn(domain, { ...message, eventId: 43n })).not.toBe(base);
  });
});
