import {
  getAddress,
  hashTypedData,
  isAddress,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type Transport,
  type TypedDataDefinition,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ShowmarkInputError, ShowmarkSigningError } from "./errors";
import type { ProofMode } from "./status";
import type { AttendeeCodePayload, DoorPassPayload } from "./qr";

// EIP-712 typed data for the Showmark registry (docs/INTERFACES.md section 2.2). The verifying contract is
// always the ShowmarkRegistry, so a signature never carries across chains, deployments or events.

export const EIP712_NAME = "Showmark";
export const EIP712_VERSION = "1";

// The attendee binds the proof mode, so a mode 2 code shown at the door cannot be replayed as mode 1 (audit M-01).
export const checkInTypes = {
  CheckIn: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
    { name: "mode", type: "uint8" },
  ],
} as const;

// The door authorizes a throwaway ticket key per rotation; its private key exists only inside the QR (audit C-01).
export const doorPassTypes = {
  DoorPass: [
    { name: "eventId", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "ticket", type: "address" },
  ],
} as const;

export const ticketTypes = {
  Ticket: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
  ],
} as const;

export const doorAttestTypes = {
  DoorAttest: [
    { name: "eventId", type: "uint256" },
    { name: "attendee", type: "address" },
    { name: "attestedAt", type: "uint64" },
  ],
} as const;

export const linkWalletTypes = {
  LinkWallet: [
    { name: "pass", type: "address" },
    { name: "wallet", type: "address" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** Where a signature is valid: the chain id and the ShowmarkRegistry address. */
export interface ShowmarkDomainParams {
  chainId: number;
  registry: Address;
}

export interface ShowmarkDomain {
  name: typeof EIP712_NAME;
  version: typeof EIP712_VERSION;
  chainId: number;
  verifyingContract: Address;
}

/**
 * Anything that can sign typed data: a viem local account (privateKeyToAccount, mnemonicToAccount, toAccount),
 * a smart account, or a wallet client with an account attached (QIE Wallet through EIP-1193).
 */
export type ShowmarkSigner =
  | Pick<LocalAccount, "address" | "signTypedData">
  | WalletClient<Transport, Chain | undefined, Account>;

const MAX_UINT64 = 2n ** 64n - 1n;
const MAX_UINT256 = 2n ** 256n - 1n;

function requireUint(name: string, value: bigint, max: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n || value > max) {
    throw new ShowmarkInputError(`${name} must be a bigint between 0 and ${max}, got ${String(value)}`);
  }
  return value;
}

// Lowercase addresses are accepted and checksummed; a mixed-case address with a wrong checksum is a typo and fails.
function requireMode(mode: number): ProofMode {
  if (mode !== 1 && mode !== 2) throw new ShowmarkInputError(`mode must be 1 or 2, got ${String(mode)}`);
  return mode;
}

function requireAddress(name: string, value: string): Address {
  if (!isAddress(value)) throw new ShowmarkInputError(`${name} is not a valid address or its checksum is wrong: ${value}`);
  return getAddress(value);
}

export function showmarkDomain({ chainId, registry }: ShowmarkDomainParams): ShowmarkDomain {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new ShowmarkInputError(`chainId must be a positive integer, got ${chainId}`);
  return { name: EIP712_NAME, version: EIP712_VERSION, chainId, verifyingContract: requireAddress("registry", registry) };
}

export function checkInTypedData(
  domain: ShowmarkDomainParams,
  message: { eventId: bigint; attendee: Address; mode: ProofMode },
): TypedDataDefinition<typeof checkInTypes, "CheckIn"> {
  return {
    domain: showmarkDomain(domain),
    types: checkInTypes,
    primaryType: "CheckIn",
    message: {
      eventId: requireUint("eventId", message.eventId, MAX_UINT256),
      attendee: requireAddress("attendee", message.attendee),
      mode: requireMode(message.mode),
    },
  };
}

export function doorPassTypedData(
  domain: ShowmarkDomainParams,
  message: { eventId: bigint; issuedAt: bigint; ticket: Address },
): TypedDataDefinition<typeof doorPassTypes, "DoorPass"> {
  return {
    domain: showmarkDomain(domain),
    types: doorPassTypes,
    primaryType: "DoorPass",
    message: {
      eventId: requireUint("eventId", message.eventId, MAX_UINT256),
      issuedAt: requireUint("issuedAt", message.issuedAt, MAX_UINT64),
      ticket: requireAddress("ticket", message.ticket),
    },
  };
}

export function ticketTypedData(
  domain: ShowmarkDomainParams,
  message: { eventId: bigint; attendee: Address },
): TypedDataDefinition<typeof ticketTypes, "Ticket"> {
  return {
    domain: showmarkDomain(domain),
    types: ticketTypes,
    primaryType: "Ticket",
    message: {
      eventId: requireUint("eventId", message.eventId, MAX_UINT256),
      attendee: requireAddress("attendee", message.attendee),
    },
  };
}

export function doorAttestTypedData(
  domain: ShowmarkDomainParams,
  message: { eventId: bigint; attendee: Address; attestedAt: bigint },
): TypedDataDefinition<typeof doorAttestTypes, "DoorAttest"> {
  return {
    domain: showmarkDomain(domain),
    types: doorAttestTypes,
    primaryType: "DoorAttest",
    message: {
      eventId: requireUint("eventId", message.eventId, MAX_UINT256),
      attendee: requireAddress("attendee", message.attendee),
      attestedAt: requireUint("attestedAt", message.attestedAt, MAX_UINT64),
    },
  };
}

export function linkWalletTypedData(
  domain: ShowmarkDomainParams,
  message: { pass: Address; wallet: Address; deadline: bigint },
): TypedDataDefinition<typeof linkWalletTypes, "LinkWallet"> {
  return {
    domain: showmarkDomain(domain),
    types: linkWalletTypes,
    primaryType: "LinkWallet",
    message: {
      pass: requireAddress("pass", message.pass),
      wallet: requireAddress("wallet", message.wallet),
      deadline: requireUint("deadline", message.deadline, MAX_UINT64),
    },
  };
}

/** The 32-byte EIP-712 digest the registry recovers a CheckIn signature against. */
export function hashCheckIn(domain: ShowmarkDomainParams, message: { eventId: bigint; attendee: Address; mode: ProofMode }): Hex {
  return hashTypedData(checkInTypedData(domain, message));
}

export function hashDoorPass(domain: ShowmarkDomainParams, message: { eventId: bigint; issuedAt: bigint; ticket: Address }): Hex {
  return hashTypedData(doorPassTypedData(domain, message));
}

export function hashTicket(domain: ShowmarkDomainParams, message: { eventId: bigint; attendee: Address }): Hex {
  return hashTypedData(ticketTypedData(domain, message));
}

export function hashDoorAttest(domain: ShowmarkDomainParams, message: { eventId: bigint; attendee: Address; attestedAt: bigint }): Hex {
  return hashTypedData(doorAttestTypedData(domain, message));
}

export function hashLinkWallet(domain: ShowmarkDomainParams, message: { pass: Address; wallet: Address; deadline: bigint }): Hex {
  return hashTypedData(linkWalletTypedData(domain, message));
}

/** The address that signs with this signer. */
export function signerAddress(signer: ShowmarkSigner): Address {
  return "request" in signer ? signer.account.address : signer.address;
}

async function sign<const types extends Record<string, readonly { name: string; type: string }[]>, primaryType extends keyof types & string>(
  signer: ShowmarkSigner,
  typedData: TypedDataDefinition<types, primaryType>,
): Promise<Hex> {
  try {
    if ("request" in signer) {
      // viem cannot carry the generic `types` through the wallet client's parameter type; the definition is complete.
      return await signer.signTypedData({ ...typedData, account: signer.account } as Parameters<typeof signer.signTypedData>[0]);
    }
    return await signer.signTypedData(typedData);
  } catch (cause) {
    throw new ShowmarkSigningError(`Could not sign ${typedData.primaryType} with ${signerAddress(signer)}`, { cause });
  }
}

/** Attendee signature over CheckIn(eventId, attendee, mode). The attendee defaults to the signer's address. */
export async function signCheckIn(
  params: ShowmarkDomainParams & { signer: ShowmarkSigner; eventId: bigint; mode: ProofMode; attendee?: Address },
): Promise<Hex> {
  const attendee = params.attendee ?? signerAddress(params.signer);
  return sign(params.signer, checkInTypedData(params, { eventId: params.eventId, attendee, mode: params.mode }));
}

/** Door key signature over DoorPass(eventId, issuedAt, ticket) for mode 1, the rotating door QR. */
export async function signDoorPass(
  params: ShowmarkDomainParams & { signer: ShowmarkSigner; eventId: bigint; issuedAt: bigint; ticket: Address },
): Promise<Hex> {
  return sign(params.signer, doorPassTypedData(params, params));
}

/** Ticket key signature over Ticket(eventId, attendee): proves the attendee saw this rotation's QR. */
export async function signTicket(
  params: ShowmarkDomainParams & { signer: ShowmarkSigner; eventId: bigint; attendee: Address },
): Promise<Hex> {
  return sign(params.signer, ticketTypedData(params, params));
}

/** Door key signature over DoorAttest(eventId, attendee, attestedAt) for mode 2, door scans you. */
export async function signDoorAttest(
  params: ShowmarkDomainParams & { signer: ShowmarkSigner; eventId: bigint; attendee: Address; attestedAt: bigint },
): Promise<Hex> {
  return sign(params.signer, doorAttestTypedData(params, params));
}

/** Signature over LinkWallet(pass, wallet, deadline). The registry needs one from the pass key and one from the wallet. */
export async function signLinkWallet(
  params: ShowmarkDomainParams & { signer: ShowmarkSigner; pass: Address; wallet: Address; deadline: bigint },
): Promise<Hex> {
  return sign(params.signer, linkWalletTypedData(params, params));
}

export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/**
 * Signs a fresh door pass, ready for `doorPassUrl`. Generates this rotation's throwaway ticket key and signs its
 * address inside DoorPass; the private key travels only in the QR. `issuedAt` defaults to now in seconds.
 */
export async function createDoorPass(
  params: ShowmarkDomainParams & { signer: ShowmarkSigner; eventId: bigint; issuedAt?: bigint; ticketKey?: Hex },
): Promise<DoorPassPayload> {
  const issuedAt = params.issuedAt ?? nowSeconds();
  const ticketKey = params.ticketKey ?? generatePrivateKey();
  const ticket = privateKeyToAccount(ticketKey).address;
  const doorSig = await signDoorPass({ ...params, issuedAt, ticket });
  return { eventId: params.eventId, issuedAt, doorSig, ticketKey };
}

/** Signs the attendee's CheckIn for mode 2 and returns the payload for `encodeAttendeeCode`. */
export async function createAttendeeCode(
  params: ShowmarkDomainParams & { signer: ShowmarkSigner; eventId: bigint },
): Promise<AttendeeCodePayload> {
  const attendee = signerAddress(params.signer);
  const attendeeSig = await signCheckIn({ ...params, attendee, mode: 2 });
  return { eventId: params.eventId, attendee, attendeeSig };
}
