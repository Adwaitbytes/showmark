import { zeroAddress, type Address } from "viem";
import { z } from "zod";
import { MAX_UINT128, parseAmount, USD_DECIMALS } from "./math";

// The create-campaign form as people type it (strings), and its validation into the exact
// CampaignVault.createCampaign arguments. Every rule here matches a revert in CampaignVault._validate,
// so a draft that passes cannot fail for a reason the form could have caught.

export type TokenChoice = "QIE" | "QUSDC";
export type PricingChoice = "token" | "usd";

export const TOKEN_DECIMALS: Record<TokenChoice, number> = { QIE: 18, QUSDC: 6 };
export const METADATA_MAX_BYTES = 2048;
const MAX_UINT32 = 2 ** 32 - 1;

export interface CampaignFormValues {
  name: string;
  sponsorName: string;
  description: string;
  url: string;
  token: TokenChoice;
  pricing: PricingChoice;
  /** Per presence: token units, or US dollars when pricing is "usd". */
  amount: string;
  attendeeShareBps: number;
  minProofMode: 1 | 2;
  requireQieId: boolean;
  /** `datetime-local` values, read in the browser's time zone. */
  startsAt: string;
  endsAt: string;
  maxPerEvent: string;
  maxTotal: string;
  openToBonded: boolean;
  /** Minimum organizer bond in QIE, when open to bonded organizers. */
  minBond: string;
  /** Deposit in the campaign token (QIE for USD pricing). */
  deposit: string;
}

export type FormField = keyof CampaignFormValues | "metadata";
export type FormErrors = Partial<Record<FormField, string>>;

/** Exactly the tuple CampaignVault.createCampaign takes as `p`. */
export interface CampaignParamsArgs {
  token: Address;
  pricing: 0 | 1;
  amountPerPresence: bigint;
  attendeeShareBps: number;
  minProofMode: 1 | 2;
  requireQieId: boolean;
  startsAt: bigint;
  endsAt: bigint;
  maxPerEvent: number;
  maxTotal: number;
  openToBonded: boolean;
  minBond: bigint;
  metadata: string;
}

export interface CampaignDraft {
  token: TokenChoice;
  params: CampaignParamsArgs;
  deposit: bigint;
}

export type ValidationResult = { ok: true; draft: CampaignDraft } | { ok: false; errors: FormErrors };

/** INTERFACES 2.5 campaign metadata. Key order is fixed so the byte count is stable. */
export const campaignMetadataSchema = z.object({
  v: z.literal(1),
  name: z.string(),
  sponsor: z.string(),
  description: z.string(),
  url: z.string().optional(),
});
export type CampaignMetadata = z.infer<typeof campaignMetadataSchema>;

export function buildMetadata(values: Pick<CampaignFormValues, "name" | "sponsorName" | "description" | "url">): string {
  const url = values.url.trim();
  const metadata: CampaignMetadata = {
    v: 1,
    name: values.name.trim(),
    sponsor: values.sponsorName.trim(),
    description: values.description.trim(),
    ...(url ? { url } : {}),
  };
  return JSON.stringify(metadata);
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** `datetime-local` value to unix seconds in the browser's zone. Null when empty or malformed. */
export function localInputToSeconds(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Unix seconds to a `datetime-local` value in the browser's zone, minute precision. */
export function secondsToLocalInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function optionalCap(raw: string): number | null | "invalid" {
  const value = raw.trim();
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return "invalid";
  const n = Number(value);
  return n > MAX_UINT32 ? "invalid" : n;
}

const httpsUrl = z.url({ protocol: /^https$/ });

/** Parsed per-presence amount in the units the vault stores: token base units, or USD with 6 decimals. */
export function perPresenceUnits(values: Pick<CampaignFormValues, "token" | "pricing" | "amount">): bigint | null {
  const decimals = values.pricing === "usd" ? USD_DECIMALS : TOKEN_DECIMALS[values.token];
  return parseAmount(values.amount, decimals);
}

/**
 * Validates the form into createCampaign arguments. `now` is unix seconds; `qusdc` is the QUSDC address on this
 * chain (zero when it does not exist here, which makes QUSDC unavailable).
 */
export function validateCampaignForm(values: CampaignFormValues, now: number, qusdc: Address): ValidationResult {
  const errors: FormErrors = {};

  const name = values.name.trim();
  if (name === "") errors.name = "Give the campaign a name people will recognise.";
  else if (name.length > 80) errors.name = "Keep the name under 80 characters.";

  const sponsorName = values.sponsorName.trim();
  if (sponsorName === "") errors.sponsorName = "Say who is paying, as attendees should see it.";
  else if (sponsorName.length > 80) errors.sponsorName = "Keep the sponsor name under 80 characters.";

  if (values.description.trim().length > 600) errors.description = "Keep the description under 600 characters.";

  const url = values.url.trim();
  if (url !== "" && !httpsUrl.safeParse(url).success) errors.url = "Use a full https:// link, or leave it empty.";

  if (values.token === "QUSDC" && qusdc === zeroAddress) {
    errors.token = "QUSDC is only on QIE Mainnet. Use native QIE on this network.";
  }
  if (values.pricing === "usd" && values.token !== "QIE") {
    errors.pricing = "USD pricing pays out in native QIE, so choose QIE as the token.";
  }

  const amount = perPresenceUnits(values);
  const amountDecimals = values.pricing === "usd" ? USD_DECIMALS : TOKEN_DECIMALS[values.token];
  if (amount === null) errors.amount = `Enter an amount like 2.50, with at most ${amountDecimals} decimal places.`;
  else if (amount === 0n) errors.amount = "The amount per person must be more than zero.";
  else if (amount > MAX_UINT128) errors.amount = "That amount is too large for the vault.";

  if (!Number.isInteger(values.attendeeShareBps) || values.attendeeShareBps < 0 || values.attendeeShareBps > 10_000) {
    errors.attendeeShareBps = "The attendee share must be between 0 and 100 percent.";
  }

  const startsAt = localInputToSeconds(values.startsAt);
  const endsAt = localInputToSeconds(values.endsAt);
  if (startsAt === null) errors.startsAt = "Pick the date and time the campaign starts paying.";
  if (endsAt === null) errors.endsAt = "Pick the date and time the campaign stops paying.";
  if (startsAt !== null && endsAt !== null) {
    if (endsAt <= startsAt) errors.endsAt = "The end must be after the start.";
    else if (endsAt <= now) errors.endsAt = "The end is in the past. Pick a time after now.";
  }

  const maxPerEvent = optionalCap(values.maxPerEvent);
  if (maxPerEvent === "invalid") errors.maxPerEvent = "Use a whole number of people, or leave it empty for no cap.";
  const maxTotal = optionalCap(values.maxTotal);
  if (maxTotal === "invalid") errors.maxTotal = "Use a whole number of people, or leave it empty for no cap.";
  if (typeof maxPerEvent === "number" && maxPerEvent === 0) errors.maxPerEvent = "Leave it empty for no cap, or use 1 or more.";
  if (typeof maxTotal === "number" && maxTotal === 0) errors.maxTotal = "Leave it empty for no cap, or use 1 or more.";

  let minBond = 0n;
  if (values.openToBonded) {
    const parsed = parseAmount(values.minBond, 18);
    if (parsed === null || parsed === 0n) errors.minBond = "Set a minimum bond in QIE above zero, for example 100.";
    else if (parsed > MAX_UINT128) errors.minBond = "That bond is too large.";
    else minBond = parsed;
  }

  const depositToken: TokenChoice = values.pricing === "usd" ? "QIE" : values.token;
  const deposit = parseAmount(values.deposit, TOKEN_DECIMALS[depositToken]);
  if (deposit === null) {
    errors.deposit = `Enter the deposit in ${depositToken}, with at most ${TOKEN_DECIMALS[depositToken]} decimal places.`;
  } else if (deposit === 0n) {
    errors.deposit = "Deposit something so the campaign can pay its first person.";
  } else if (values.pricing === "token" && amount !== null && amount > 0n && deposit < amount) {
    errors.deposit = "The deposit is less than one payout. Raise it to at least the amount per person.";
  }

  const metadata = buildMetadata(values);
  const bytes = utf8Length(metadata);
  if (bytes > METADATA_MAX_BYTES) {
    errors.metadata = `Name, sponsor, description and link take ${bytes} bytes. The vault allows ${METADATA_MAX_BYTES}, so shorten the description.`;
  }

  if (Object.keys(errors).length > 0 || amount === null || deposit === null || startsAt === null || endsAt === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    draft: {
      token: depositToken,
      deposit,
      params: {
        token: depositToken === "QUSDC" ? qusdc : zeroAddress,
        pricing: values.pricing === "usd" ? 1 : 0,
        amountPerPresence: amount,
        attendeeShareBps: values.attendeeShareBps,
        minProofMode: values.minProofMode,
        requireQieId: values.requireQieId,
        startsAt: BigInt(startsAt),
        endsAt: BigInt(endsAt),
        maxPerEvent: typeof maxPerEvent === "number" ? maxPerEvent : 0,
        maxTotal: typeof maxTotal === "number" ? maxTotal : 0,
        openToBonded: values.openToBonded,
        minBond,
        metadata,
      },
    },
  };
}
