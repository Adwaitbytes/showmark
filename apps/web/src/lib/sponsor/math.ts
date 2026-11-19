// Money math for the sponsor console. Every function mirrors CampaignVault exactly (integer division, floor),
// so the numbers a sponsor reads before signing are the numbers the chain will produce.

export const BPS = 10_000n;
export const MAX_FEE_BPS = 500;
/** CampaignVault.SETTLE_GRACE: refunds open this long after a campaign ends. */
export const SETTLE_GRACE_SECONDS = 3 * 24 * 60 * 60;
/** USD amounts per presence carry 6 decimals, like QUSDC. */
export const USD_DECIMALS = 6;
export const MAX_UINT128 = 2n ** 128n - 1n;

export interface PayoutSplit {
  gross: bigint;
  fee: bigint;
  toAttendee: bigint;
  toOrganizer: bigint;
}

function assertBps(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new RangeError(`${label} must be 0 to 10000 basis points`);
}

/** Vault `_credit`: protocol fee first, then the attendee share of what is left, and the organizer gets the rest. */
export function splitPayout(gross: bigint, feeBps: number, attendeeShareBps: number): PayoutSplit {
  if (gross < 0n) throw new RangeError("gross must not be negative");
  assertBps(feeBps, "feeBps");
  assertBps(attendeeShareBps, "attendeeShareBps");
  const fee = (gross * BigInt(feeBps)) / BPS;
  const net = gross - fee;
  const toAttendee = (net * BigInt(attendeeShareBps)) / BPS;
  return { gross, fee, toAttendee, toOrganizer: net - toAttendee };
}

/**
 * Vault `_quote` for USD pricing: wei = usd6 * 10^(12 + oracleDecimals) / answer, rounded down.
 * Returns null when the vault would defer instead of paying (non-positive answer, or a quote that rounds to zero).
 */
export function usdToNativeWei(usd6: bigint, answer: bigint, oracleDecimals: number): bigint | null {
  if (!Number.isInteger(oracleDecimals) || oracleDecimals < 0 || oracleDecimals > 18) throw new RangeError("oracleDecimals must be 0 to 18");
  if (usd6 < 0n) throw new RangeError("usd amount must not be negative");
  if (answer <= 0n) return null;
  const wei = (usd6 * 10n ** BigInt(12 + oracleDecimals)) / answer;
  return wei === 0n ? null : wei;
}

/** How many verified presences a deposit pays for at a fixed gross per presence. */
export function presencesCovered(deposit: bigint, perPresence: bigint): bigint {
  if (perPresence <= 0n) return 0n;
  if (deposit <= 0n) return 0n;
  return deposit / perPresence;
}

/** Unix seconds at which `refund` stops reverting with RefundNotYetAvailable (the vault checks `now > endsAt + grace`). */
export function refundOpensAt(endsAtSeconds: number): number {
  return endsAtSeconds + SETTLE_GRACE_SECONDS + 1;
}

/** Oracle answer as a plain USD number, for display only. Never used for money math. */
export function oraclePriceToNumber(answer: bigint, decimals: number): number {
  const scale = 10 ** decimals;
  const whole = answer / BigInt(scale);
  const fraction = answer % BigInt(scale);
  return Number(whole) + Number(fraction) / scale;
}

/**
 * Parses a human amount ("12.5") into base units with exact decimal handling.
 * Returns null for anything that is not a plain non-negative decimal with at most `decimals` fraction digits.
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  const value = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(value)) return null;
  const [integerPart = "", fractionPart = ""] = value.split(".");
  if (fractionPart.length > decimals) return null;
  const whole = integerPart === "" ? 0n : BigInt(integerPart);
  const fraction = fractionPart === "" ? 0n : BigInt(fractionPart.padEnd(decimals, "0"));
  return whole * 10n ** BigInt(decimals) + fraction;
}

/** Base units back to an editable plain decimal string, without grouping and without trailing zeros. */
export function formatPlain(baseUnits: bigint, decimals: number): string {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
