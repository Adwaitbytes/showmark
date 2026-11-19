import { getAddress, isAddress, isHex, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";

// Wire schemas for every /api route input. Big integers travel as decimal strings, bytes as 0x hex.

const MAX_UINT64 = 2n ** 64n - 1n;
const MAX_UINT256 = 2n ** 256n - 1n;

export const addressSchema = z
  .string()
  .trim()
  .refine((v) => isAddress(v, { strict: false }), "must be a 0x address")
  .transform((v): Address => getAddress(v));

function uintString(max: bigint, label: string) {
  return z
    .string()
    .trim()
    .regex(/^[0-9]{1,78}$/, `${label} must be a decimal integer string`)
    .transform((v) => BigInt(v))
    .refine((v) => v <= max, `${label} is too large`);
}

export const uint256String = uintString(MAX_UINT256, "value");
export const uint64String = uintString(MAX_UINT64, "value");
export const idString = uintString(MAX_UINT256, "id").refine((v) => v > 0n, "id must be positive");

/** A 65 byte ECDSA signature (pass keys and door keys are EOAs). */
export const signature65 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65 byte signature")
  .transform((v): Hex => v.toLowerCase() as Hex);

/** Wallet signatures may come from a contract wallet (ERC-1271), so any length up to 4 KiB is accepted. */
export const walletSignature = z
  .string()
  .refine((v) => isHex(v) && v.length >= 4 && v.length <= 2 + 8192 && v.length % 2 === 0, "must be 0x hex bytes")
  .transform((v): Hex => v.toLowerCase() as Hex);

/**
 * CheckInData in the field order of the registry struct. Mode 1 (rotating QR) carries the ticket key's address and
 * its Ticket signature; mode 2 (door scans you) carries the zero address and empty bytes.
 */
export const checkInDataSchema = z
  .object({
    eventId: idString,
    attendee: addressSchema,
    mode: z.union([z.literal(1), z.literal(2)]),
    doorTime: uint64String,
    ticket: addressSchema,
    attendeeSig: signature65,
    doorSig: signature65,
    ticketSig: z
      .string()
      .regex(/^0x([0-9a-fA-F]{130})?$/, "must be a 65 byte signature, or 0x in mode 2")
      .transform((v): Hex => v.toLowerCase() as Hex),
  })
  .superRefine((d, ctx) => {
    if (d.mode === 1) {
      if (d.ticket === zeroAddress) ctx.addIssue({ code: "custom", path: ["ticket"], message: "mode 1 needs the ticket address" });
      if (d.ticketSig === "0x") ctx.addIssue({ code: "custom", path: ["ticketSig"], message: "mode 1 needs a ticket signature" });
    } else {
      if (d.ticket !== zeroAddress) ctx.addIssue({ code: "custom", path: ["ticket"], message: "mode 2 has no ticket" });
      if (d.ticketSig !== "0x") ctx.addIssue({ code: "custom", path: ["ticketSig"], message: "mode 2 has no ticket signature" });
    }
  });
export type CheckInData = z.output<typeof checkInDataSchema>;

export const MAX_BATCH_ITEMS = 50;

export const checkInBatchSchema = z.object({
  items: z.array(checkInDataSchema).min(1).max(MAX_BATCH_ITEMS),
});

export const linkWalletSchema = z.object({
  pass: addressSchema,
  wallet: addressSchema,
  deadline: uint64String,
  passSig: signature65,
  walletSig: walletSignature,
  relocateEventIds: z.array(idString).max(200).default([]),
});
export type LinkWalletRequest = z.output<typeof linkWalletSchema>;

export const withdrawSchema = z.object({
  token: addressSchema,
  account: addressSchema,
});

export const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v): Hex => v.toLowerCase() as Hex);

const booleanFlag = z
  .enum(["1", "0", "true", "false"])
  .transform((v) => v === "1" || v === "true")
  .optional();

const pageLimit = z.coerce.number().int().min(1).max(100).optional();
const pageOffset = z.coerce.number().int().min(0).max(100_000).optional();

export const eventsQuerySchema = z.object({
  organizer: addressSchema.optional(),
  upcoming: booleanFlag,
  limit: pageLimit,
  offset: pageOffset,
});

export const campaignsQuerySchema = z.object({
  sponsor: addressSchema.optional(),
  limit: pageLimit,
  offset: pageOffset,
});

export const reportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("json"),
});

/** Turns URLSearchParams into a plain object, dropping empty values so optional fields stay optional. */
export function searchParamsObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params) if (value !== "") out[key] = value;
  return out;
}
