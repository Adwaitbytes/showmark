import { z } from "zod";

// Runtime mirrors of apps/web/src/lib/api/types.ts, so every byte from the Showmark API is checked before an
// agent sees it. Bigints travel as decimal strings, addresses as 0x hex, timestamps as ISO 8601.

export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an 0x address");
export const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "a 32-byte 0x hash");
export const decimal = z.string().regex(/^[0-9]+$/, "a decimal integer string");
const tokenSymbol = z.enum(["QIE", "QUSDC"]);
const proofMode = z.union([z.literal(1), z.literal(2)]);

export const eventMetadata = z.object({
  v: z.literal(1),
  name: z.string(),
  venue: z.string(),
  city: z.string(),
  description: z.string(),
  url: z.string().optional(),
});

export const eventSummary = z.object({
  id: decimal,
  organizer: address,
  organizerName: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number().int(),
  checkedIn: z.number().int(),
  maxPassAge: z.number().int(),
  seriesId: decimal,
  seriesIndex: z.number().int(),
  metadata: eventMetadata,
  createdTx: txHash,
});

export const campaignPaying = z.object({
  id: decimal,
  name: z.string(),
  sponsorName: z.string(),
  token: address,
  tokenSymbol,
  attendeeAmount: decimal,
  requireQieId: z.boolean(),
  minProofMode: proofMode,
});

export const eventDetail = eventSummary.extend({
  campaigns: z.array(campaignPaying),
  recentCheckIns: z.array(
    z.object({ attendee: address, name: z.string().nullable(), at: z.string(), tx: txHash, mode: proofMode }),
  ),
});

export const stamp = z.object({
  eventId: decimal,
  eventName: z.string(),
  city: z.string(),
  at: z.string(),
  mode: proofMode,
  tx: txHash,
  streak: z.number().int(),
});

export const passport = z.object({
  pass: address.nullable(),
  wallet: address.nullable(),
  qieName: z.string().nullable(),
  holdsQieId: z.boolean(),
  stamps: z.array(stamp),
  streaks: z.array(z.object({ seriesId: decimal, seriesName: z.string(), current: z.number().int(), best: z.number().int() })),
  claimable: z.array(z.object({ token: address, symbol: tokenSymbol, amount: decimal })),
  pending: z.array(z.object({ campaignId: decimal, eventId: decimal, reason: z.enum(["NeedsQieId", "PriceStale", "Pending"]) })),
});

export const campaignSummary = z.object({
  id: decimal,
  sponsor: address,
  sponsorName: z.string(),
  name: z.string(),
  description: z.string(),
  token: address,
  tokenSymbol,
  pricing: z.union([z.literal(0), z.literal(1)]),
  amountPerPresence: decimal,
  attendeeShareBps: z.number().int(),
  feeBps: z.number().int(),
  minProofMode: proofMode,
  requireQieId: z.boolean(),
  startsAt: z.string(),
  endsAt: z.string(),
  balance: decimal,
  funded: decimal,
  settledCount: z.number().int(),
  settledAmount: decimal,
  teamFunded: z.boolean(),
  status: z.enum(["scheduled", "live", "ended", "refundable", "refunded"]),
});

export const settlement = z.object({
  campaignId: decimal,
  eventId: decimal,
  eventName: z.string(),
  attendee: address,
  organizer: address,
  gross: decimal,
  toAttendee: decimal,
  toOrganizer: decimal,
  fee: decimal,
  at: z.string(),
  tx: txHash,
});

export const campaignDetail = campaignSummary.extend({
  events: z.array(eventSummary.extend({ approved: z.boolean(), settled: z.number().int() })),
  settlements: z.array(settlement),
});

export const traction = z.object({
  updatedAt: z.string(),
  verifiedAttendees: z.number(),
  eventsWithCheckIns: z.number(),
  organizers: z.number(),
  sponsors: z.object({ teamFunded: z.number(), external: z.number() }),
  settled: z.array(z.object({ token: address, symbol: tokenSymbol, teamFunded: decimal, external: decimal })),
  settledUsd: z.object({ teamFunded: z.number(), external: z.number(), price: z.number(), priceUpdatedAt: z.string() }),
  newWalletsViaShowmark: z.number(),
  passesLinked: z.number(),
  conversionRate: z.number(),
  attendeesWithQieId: z.number(),
  repeatAttendees: z.number(),
  showmarkTransactions: z.number(),
  chainDailyTransactions: z.number().nullable(),
  shareOfChainDaily: z.number().nullable(),
  daily: z.array(z.object({ date: z.string(), checkIns: z.number(), settlements: z.number() })),
});

export const apiError = z.object({ error: z.object({ code: z.string(), message: z.string(), action: z.string() }) });

export type EventSummary = z.infer<typeof eventSummary>;
export type EventDetail = z.infer<typeof eventDetail>;
export type Passport = z.infer<typeof passport>;
export type CampaignDetail = z.infer<typeof campaignDetail>;
export type Settlement = z.infer<typeof settlement>;
export type Traction = z.infer<typeof traction>;
