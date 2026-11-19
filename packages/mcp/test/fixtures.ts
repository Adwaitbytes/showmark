import type { CampaignDetail, EventDetail, EventSummary, Passport, ShowmarkDataSource, Traction } from "../src/index";

export const organizer = "0x4444444444444444444444444444444444444444";
export const alice = "0x5555555555555555555555555555555555555555";
export const bob = "0x6666666666666666666666666666666666666666";
export const tx = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, "0")}`;

export const summary: EventSummary = {
  id: "42",
  organizer,
  organizerName: "meetups.qie",
  startsAt: "2026-11-26T12:30:00.000Z",
  endsAt: "2026-11-26T15:30:00.000Z",
  capacity: 120,
  checkedIn: 37,
  maxPassAge: 60,
  seriesId: "0",
  seriesIndex: 0,
  metadata: { v: 1, name: "QIE builders night", venue: "Hall B", city: "Bengaluru", description: "Monthly meetup" },
  createdTx: tx(1),
};

export const eventDetail: EventDetail = {
  ...summary,
  campaigns: [
    { id: "7", name: "Builders pool", sponsorName: "Acme", token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", tokenSymbol: "QUSDC", attendeeAmount: "980000", requireQieId: false, minProofMode: 1 },
  ],
  recentCheckIns: [{ attendee: alice, name: null, at: "2026-11-26T12:41:00.000Z", tx: tx(2), mode: 1 }],
};

export const campaign: CampaignDetail = {
  id: "7",
  sponsor: bob,
  sponsorName: "Acme",
  name: "Builders pool",
  description: "Pays for every verified builder",
  token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  tokenSymbol: "QUSDC",
  pricing: 0,
  amountPerPresence: "2000000",
  attendeeShareBps: 5000,
  feeBps: 200,
  minProofMode: 1,
  requireQieId: false,
  startsAt: "2026-11-20T00:00:00.000Z",
  endsAt: "2026-12-20T00:00:00.000Z",
  balance: "94000000",
  funded: "100000000",
  settledCount: 3,
  settledAmount: "6000000",
  teamFunded: false,
  status: "live",
  events: [{ ...summary, approved: true, settled: 3 }],
  settlements: [1, 2, 3].map((n) => ({
    campaignId: "7",
    eventId: "42",
    eventName: "QIE builders night",
    attendee: n === 3 ? alice : `0x${String(n).repeat(40)}`,
    organizer,
    gross: "2000000",
    toAttendee: "980000",
    toOrganizer: "980000",
    fee: "40000",
    at: `2026-11-26T12:4${n}:00.000Z`,
    tx: tx(10 + n),
  })),
};

export const passport: Passport = {
  pass: alice,
  wallet: null,
  qieName: "alice.qie",
  holdsQieId: true,
  stamps: [{ eventId: "42", eventName: "QIE builders night", city: "Bengaluru", at: "2026-11-26T12:41:00.000Z", mode: 1, tx: tx(2), streak: 0 }],
  streaks: [],
  claimable: [{ token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", symbol: "QUSDC", amount: "980000" }],
  pending: [],
};

export const traction: Traction = {
  updatedAt: "2026-11-26T13:00:00.000Z",
  verifiedAttendees: 37,
  eventsWithCheckIns: 1,
  organizers: 1,
  sponsors: { teamFunded: 1, external: 1 },
  settled: [{ token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", symbol: "QUSDC", teamFunded: "0", external: "6000000" }],
  settledUsd: { teamFunded: 0, external: 6, price: 0.12, priceUpdatedAt: "2026-11-26T12:00:00.000Z" },
  newWalletsViaShowmark: 12,
  passesLinked: 9,
  conversionRate: 0.24,
  attendeesWithQieId: 6,
  repeatAttendees: 0,
  showmarkTransactions: 80,
  chainDailyTransactions: 4000,
  shareOfChainDaily: 0.02,
  daily: [{ date: "2026-11-26", checkIns: 37, settlements: 3 }],
};

export function fakeData(): ShowmarkDataSource {
  return {
    getTraction: async () => traction,
    listEvents: async () => [summary],
    getEvent: async (id) => (id === "42" ? eventDetail : null),
    getCampaign: async (id) => (id === "7" ? campaign : null),
    getPassport: async (q) => (q === "alice.qie" || q.toLowerCase() === alice ? passport : null),
  };
}
