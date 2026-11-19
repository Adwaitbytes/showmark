import type { Address, Hex } from "viem";
import { apiRequest, getTxStatus, postJson, type ApiResult, type RequestOptions } from "./api";
import { address, array, bool, digits, hex, nullable, num, object, oneOf, str, toParser } from "./guard";

// Passport, wallet link, withdraw and event list routes, validated with the small readers in guard.ts. Loaded by /pass and its sub-pages, and by
// the check-in screen only on demand (dynamic import), so the door route stays small.

const passportSchema = object({
  pass: nullable(address),
  wallet: nullable(address),
  qieName: nullable(str),
  holdsQieId: bool,
  stamps: array(object({ eventId: str, eventName: str, city: str, at: str, mode: oneOf(1, 2), tx: hex, streak: num })),
  streaks: array(object({ seriesId: str, seriesName: str, current: num, best: num })),
  claimable: array(object({ token: address, symbol: oneOf("QIE", "QUSDC"), amount: digits })),
  pending: array(object({ campaignId: str, eventId: str, reason: oneOf("NeedsQieId", "PriceStale", "Pending") })),
});

export type PassportData = Exclude<ReturnType<typeof passportSchema>, symbol>;

export const parsePassport = toParser(passportSchema);

export function getPassport(address: Address, options?: RequestOptions): Promise<ApiResult<PassportData>> {
  return apiRequest(`/api/passport/${address}`, { method: "GET", cache: "no-store" }, parsePassport, options);
}

const txSchema = object({ txHash: hex });
export type TxSubmitted = Exclude<ReturnType<typeof txSchema>, symbol>;

export interface LinkWalletBody {
  pass: Address;
  wallet: Address;
  deadline: string;
  passSig: Hex;
  walletSig: Hex;
  relocateEventIds: string[];
}

export function postLinkWallet(body: LinkWalletBody, options?: RequestOptions): Promise<ApiResult<TxSubmitted>> {
  return apiRequest("/api/relay/link-wallet", postJson(body), toParser(txSchema), { timeoutMs: 30_000, ...options });
}

export function postWithdraw(body: { token: Address; account: Address }, options?: RequestOptions): Promise<ApiResult<TxSubmitted>> {
  return apiRequest("/api/relay/withdraw", postJson(body), toParser(txSchema), { timeoutMs: 30_000, ...options });
}

const eventListSchema = array(object({ id: str, startsAt: str, endsAt: str, metadata: object({ name: str, city: str }) }));
export type EventListItem = Exclude<ReturnType<typeof eventListSchema>, symbol>[number];

export function listUpcomingEvents(options?: RequestOptions): Promise<ApiResult<EventListItem[]>> {
  return apiRequest("/api/events?upcoming=1&limit=20", { method: "GET" }, toParser(eventListSchema), options);
}

const campaignSchema = object({ id: str, name: str, sponsorName: str, endsAt: str });
export type CampaignBrief = Exclude<ReturnType<typeof campaignSchema>, symbol>;

/** Name and end date of a campaign, for explaining a pending payout. */
export function getCampaignBrief(id: string, options?: RequestOptions): Promise<ApiResult<CampaignBrief>> {
  return apiRequest(`/api/campaigns/${encodeURIComponent(id)}`, { method: "GET" }, toParser(campaignSchema), options);
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
