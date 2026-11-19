import * as z from "zod/mini";
import type { Address, Hex } from "viem";
import { apiRequest, getTxStatus, postJson, type ApiResult, type Parser, type RequestOptions } from "./api";

// Passport, wallet link, withdraw and event list routes. Loaded by /pass and its sub-pages, and by
// the check-in screen only on demand (dynamic import), so the door route stays small.

/** Adapts a zod/mini schema to the client's parser contract. */
function parser<T>(schema: z.ZodMiniType<T>): Parser<T> {
  return (body) => {
    const result = schema.safeParse(body);
    return result.success ? result.data : null;
  };
}

const hexSchema = z.custom<Hex>((value) => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value));
const addressSchema = z.custom<Address>((value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value));
const digitsSchema = z.string().check(z.regex(/^\d+$/));
const modeSchema = z.union([z.literal(1), z.literal(2)]);
const symbolSchema = z.enum(["QIE", "QUSDC"]);

const passportSchema = z.object({
  pass: z.nullable(addressSchema),
  wallet: z.nullable(addressSchema),
  qieName: z.nullable(z.string()),
  holdsQieId: z.boolean(),
  stamps: z.array(
    z.object({
      eventId: z.string(),
      eventName: z.string(),
      city: z.string(),
      at: z.string(),
      mode: modeSchema,
      tx: hexSchema,
      streak: z.number(),
    }),
  ),
  streaks: z.array(z.object({ seriesId: z.string(), seriesName: z.string(), current: z.number(), best: z.number() })),
  claimable: z.array(z.object({ token: addressSchema, symbol: symbolSchema, amount: digitsSchema })),
  pending: z.array(
    z.object({
      campaignId: z.string(),
      eventId: z.string(),
      reason: z.enum(["NeedsQieId", "PriceStale", "Pending"]),
    }),
  ),
});

export type PassportData = z.infer<typeof passportSchema>;

export function getPassport(address: Address, options?: RequestOptions): Promise<ApiResult<PassportData>> {
  return apiRequest(`/api/passport/${address}`, { method: "GET", cache: "no-store" }, parser(passportSchema), options);
}

const txSchema = z.object({ txHash: hexSchema });
export type TxSubmitted = z.infer<typeof txSchema>;

export interface LinkWalletBody {
  pass: Address;
  wallet: Address;
  deadline: string;
  passSig: Hex;
  walletSig: Hex;
  relocateEventIds: string[];
}

export function postLinkWallet(body: LinkWalletBody, options?: RequestOptions): Promise<ApiResult<TxSubmitted>> {
  return apiRequest("/api/relay/link-wallet", postJson(body), parser(txSchema), { timeoutMs: 30_000, ...options });
}

export function postWithdraw(body: { token: Address; account: Address }, options?: RequestOptions): Promise<ApiResult<TxSubmitted>> {
  return apiRequest("/api/relay/withdraw", postJson(body), parser(txSchema), { timeoutMs: 30_000, ...options });
}

const eventListSchema = z.array(
  z.object({
    id: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    metadata: z.object({ name: z.string(), city: z.string() }),
  }),
);
export type EventListItem = z.infer<typeof eventListSchema>[number];

export function listUpcomingEvents(options?: RequestOptions): Promise<ApiResult<EventListItem[]>> {
  return apiRequest("/api/events?upcoming=1&limit=20", { method: "GET" }, parser(eventListSchema), options);
}

const campaignSchema = z.object({ id: z.string(), name: z.string(), sponsorName: z.string(), endsAt: z.string() });
export type CampaignBrief = z.infer<typeof campaignSchema>;

/** Name and end date of a campaign, for explaining a pending payout. */
export function getCampaignBrief(id: string, options?: RequestOptions): Promise<ApiResult<CampaignBrief>> {
  return apiRequest(`/api/campaigns/${encodeURIComponent(id)}`, { method: "GET" }, parser(campaignSchema), options);
}

/**
 * The wallet linked to this pass, or null. The passport route reads an address it has no record of
 * as a wallet (pass null, wallet = the address), which is what a brand new pass looks like before
 * the index sees its first check-in, so a link only counts when the route names this pass.
 */
export function linkedWalletOf(passport: PassportData, pass: Address): Address | null {
  if (!passport.pass || passport.pass.toLowerCase() !== pass.toLowerCase()) return null;
  return passport.wallet;
}

export type TxOutcome = "success" | "reverted" | "timeout";

/** Polls GET /api/tx/{hash} until the transaction is mined or `timeoutMs` passes. A failed read just polls again. */
export async function waitForTx(hash: Hex, signal: AbortSignal, { pollMs = 800, timeoutMs = 45_000 } = {}): Promise<TxOutcome> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getTxStatus(hash, { signal });
    if (signal.aborted) return "timeout";
    if (result.ok && result.data.status !== "pending") return result.data.status;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return "timeout";
}
