import { ShowmarkInputError } from "./errors";

// The vault's payout formula (docs/INTERFACES.md section 2.5), in integer math so it matches the contract to the wei.

export interface PayoutSplit {
  gross: bigint;
  fee: bigint;
  toAttendee: bigint;
  toOrganizer: bigint;
}

export function splitPayout(gross: bigint, feeBps: number, attendeeShareBps: number): PayoutSplit {
  if (gross < 0n) throw new ShowmarkInputError("gross must not be negative");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new ShowmarkInputError("feeBps must be an integer from 0 to 10000");
  if (!Number.isInteger(attendeeShareBps) || attendeeShareBps < 0 || attendeeShareBps > 10_000) {
    throw new ShowmarkInputError("attendeeShareBps must be an integer from 0 to 10000");
  }
  const fee = (gross * BigInt(feeBps)) / 10_000n;
  const net = gross - fee;
  const toAttendee = (net * BigInt(attendeeShareBps)) / 10_000n;
  return { gross, fee, toAttendee, toOrganizer: net - toAttendee };
}
