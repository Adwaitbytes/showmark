// Response shapes for /api/* routes. Owned by the lead; B implements them, C/D/E/F consume them.
// All bigint values travel as decimal strings. Addresses are checksummed. Timestamps are ISO 8601 strings.

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export interface ApiError {
  error: { code: string; message: string; action: string };
}

export interface EventMetadata {
  v: 1;
  name: string;
  venue: string;
  city: string;
  description: string;
  url?: string;
}

export interface EventSummary {
  id: string;
  organizer: Address;
  organizerName: string | null; // .qie name if any
  startsAt: string;
  endsAt: string;
  capacity: number; // 0 = unlimited
  checkedIn: number;
  maxPassAge: number;
  seriesId: string; // "0" = none
  seriesIndex: number;
  metadata: EventMetadata;
  createdTx: Hex;
}

export interface CampaignPaying {
  id: string;
  name: string;
  sponsorName: string;
  token: Address; // zero address = native QIE
  tokenSymbol: "QIE" | "QUSDC";
  attendeeAmount: string; // what one attendee receives now, token base units
  requireQieId: boolean;
  minProofMode: 1 | 2;
}

export interface EventDetail extends EventSummary {
  campaigns: CampaignPaying[];
  recentCheckIns: { attendee: Address; name: string | null; at: string; tx: Hex; mode: 1 | 2 }[];
}

export interface Stamp {
  eventId: string;
  eventName: string;
  city: string;
  at: string;
  mode: 1 | 2;
  tx: Hex;
  streak: number;
}

export interface Passport {
  pass: Address | null;
  wallet: Address | null;
  qieName: string | null;
  holdsQieId: boolean;
  stamps: Stamp[];
  streaks: { seriesId: string; seriesName: string; current: number; best: number }[];
  claimable: { token: Address; symbol: "QIE" | "QUSDC"; amount: string }[];
  pending: { campaignId: string; eventId: string; reason: "NeedsQieId" | "PriceStale" | "Pending" }[];
}

export interface CampaignSummary {
  id: string;
  sponsor: Address;
  sponsorName: string;
  name: string;
  description: string;
  token: Address;
  tokenSymbol: "QIE" | "QUSDC";
  pricing: 0 | 1; // 0 token amount, 1 USD paid in native QIE
  amountPerPresence: string; // token base units, or USD with 6 decimals when pricing = 1
  attendeeShareBps: number;
  feeBps: number;
  minProofMode: 1 | 2;
  requireQieId: boolean;
  startsAt: string;
  endsAt: string;
  balance: string; // remaining escrow, token base units
  funded: string; // total deposited
  settledCount: number;
  settledAmount: string;
  teamFunded: boolean;
  status: "scheduled" | "live" | "ended" | "refundable" | "refunded";
}

export interface Settlement {
  campaignId: string;
  eventId: string;
  eventName: string;
  attendee: Address;
  organizer: Address;
  gross: string;
  toAttendee: string;
  toOrganizer: string;
  fee: string;
  at: string;
  tx: Hex;
}

export interface CampaignDetail extends CampaignSummary {
  events: (EventSummary & { approved: boolean; settled: number })[];
  settlements: Settlement[];
}

export interface Traction {
  updatedAt: string;
  verifiedAttendees: number;
  eventsWithCheckIns: number;
  organizers: number;
  sponsors: { teamFunded: number; external: number };
  settled: { token: Address; symbol: "QIE" | "QUSDC"; teamFunded: string; external: string }[];
  settledUsd: { teamFunded: number; external: number; price: number; priceUpdatedAt: string };
  newWalletsViaShowmark: number;
  passesLinked: number;
  conversionRate: number; // passesLinked / verifiedAttendees
  attendeesWithQieId: number;
  repeatAttendees: number; // two or more events
  showmarkTransactions: number;
  chainDailyTransactions: number | null;
  shareOfChainDaily: number | null;
  daily: { date: string; checkIns: number; settlements: number }[];
}

export interface RelaySubmitted {
  txHash: Hex;
  status: "submitted";
}

export interface TxStatus {
  status: "pending" | "success" | "reverted";
  blockNumber?: string;
}

export interface Session {
  address: Address;
  qieName: string | null;
  expiresAt: string;
}
